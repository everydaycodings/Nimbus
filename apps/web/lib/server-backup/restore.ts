// Getting data back: browse a snapshot as a lazy tree, download a file or a folder, restore over ssh, restore into
// Files, or hand over the restic command. An SSH-pull snapshot is one tar per source, so browsing and downloading read
// through that tar; a push agent's snapshot holds real files and restic reads them directly.
import "server-only"

import { spawn, type ChildProcess } from "node:child_process"
import { Readable } from "node:stream"

import { makeZip } from "client-zip"
import { and, eq, isNull } from "drizzle-orm"

import { audit } from "@/lib/audit"
import { db } from "@/lib/db"
import { nodes, serverBackupHosts, serverBackupJobs, serverBackupSnapshots } from "@/lib/db/schema"
import { redis } from "@/lib/redis"
import { storeFile } from "@/lib/store-file"
import { mkdirp } from "@/lib/uploads"
import { dest, spawnRestic, withTransport, type Host, type Job } from "./exec"
import { cleanName, repoOpts, repoUrl, shq, sourceFile, tail, tarEntries, volumeUntar } from "./rules"

type Snap = typeof serverBackupSnapshots.$inferSelect
export type Ctx = { snap: Snap; job: Job; host: Host }

export async function snapshotCtx(userId: string, snapshotId: string): Promise<Ctx | null> {
  if (!/^[0-9a-f-]{36}$/i.test(snapshotId)) return null
  const [row] = await db
    .select({ snap: serverBackupSnapshots, job: serverBackupJobs, host: serverBackupHosts })
    .from(serverBackupSnapshots)
    .innerJoin(serverBackupJobs, eq(serverBackupJobs.id, serverBackupSnapshots.jobId))
    .innerJoin(serverBackupHosts, eq(serverBackupHosts.id, serverBackupJobs.hostId))
    .where(and(eq(serverBackupSnapshots.id, snapshotId), eq(serverBackupJobs.userId, userId)))
  return row ?? null
}

// The tar stream of the whole snapshot (tar-kind) or of `path` in it (files-kind).
function tarDump(c: Ctx, path = "/"): ChildProcess {
  return c.snap.kind === "tar" ? spawnRestic(c.job, ["dump", c.snap.resticId, `/${sourceFile(c.snap.source)}`]) : spawnRestic(c.job, ["dump", "--archive", "tar", c.snap.resticId, path || "/"])
}

// Rejects with restic's own stderr when the process ends badly.
function closing(p: ChildProcess) {
  let err = ""
  p.stderr?.on("data", (b: Buffer) => (err = tail(err + b, 2000)))
  const done = new Promise<void>((resolve, reject) => p.on("close", (code) => (code === 0 || p.killed ? resolve() : reject(new Error(err.trim().split("\n").slice(-2).join(" ") || "restic stopped.")))))
  done.catch(() => {})
  return done
}

// ---- browsing --------------------------------------------------------------------------------------------------

export type Entry = { path: string; type: "file" | "dir"; size: number; mtime: number }
export type Child = { name: string; path: string; type: "file" | "dir"; size: number; mtime: number }
const LIST_CAP = 300_000
const rel = (p: string) => cleanName(p.replace(/^\/+/, ""))

async function listing(c: Ctx): Promise<Entry[]> {
  const key = `sb:ls:${c.snap.id}`
  const hit = await redis.get(key).catch(() => null)
  if (hit) return JSON.parse(hit) as Entry[]
  const out: Entry[] = []
  if (c.snap.kind === "tar") {
    const p = spawnRestic(c.job, ["dump", c.snap.resticId, `/${sourceFile(c.snap.source)}`])
    const end = closing(p)
    for await (const e of tarEntries(p.stdout!)) {
      if (!e.name || e.type === "link") continue
      out.push({ path: e.name, type: e.type, size: e.size, mtime: e.mtime })
      if (out.length > LIST_CAP) p.kill()
    }
    await end
  } else {
    const p = spawnRestic(c.job, ["ls", "--json", c.snap.resticId])
    const end = closing(p)
    let buf = ""
    const take = (l: string) => {
      try {
        const j = JSON.parse(l)
        if (j.struct_type === "node" && (j.type === "file" || j.type === "dir")) out.push({ path: rel(j.path), type: j.type, size: Number(j.size ?? 0), mtime: Date.parse(j.mtime) / 1000 || 0 })
      } catch {}
    }
    for await (const b of p.stdout!) {
      const ls = (buf + b).split("\n")
      buf = ls.pop() ?? ""
      ls.forEach(take)
      if (out.length > LIST_CAP) p.kill()
    }
    take(buf)
    await end
  }
  if (out.length > LIST_CAP) throw new Error("This snapshot has too many files to browse. Restore it, or use the restic command.")
  await redis.set(key, JSON.stringify(out), "EX", 3600).catch(() => {})
  return out
}

// What is directly inside `dir` ("" for the top). Folders that only exist as the parent of a path are made up here.
export async function children(c: Ctx, dir: string): Promise<Child[]> {
  const base = rel(dir)
  const pre = base ? `${base}/` : ""
  const seen = new Map<string, Child>()
  for (const e of await listing(c)) {
    if (!e.path.startsWith(pre) || e.path === base) continue
    const rest = e.path.slice(pre.length)
    const [name, ...more] = rest.split("/")
    const dirish = more.length > 0 || e.type === "dir"
    const prev = seen.get(name)
    if (!prev || (dirish && prev.type === "file")) seen.set(name, { name, path: `${pre}${name}`, type: dirish ? "dir" : "file", size: dirish ? 0 : e.size, mtime: e.mtime })
  }
  return [...seen.values()].sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1))
}

// ---- downloading -----------------------------------------------------------------------------------------------

async function* fileFromTar(p: ChildProcess, path: string) {
  for await (const e of tarEntries(p.stdout!)) {
    if (e.name === path && e.type === "file") return yield* e.data()
  }
  throw new Error("That file isn't in the snapshot.")
}

async function* zipOf(p: ChildProcess, path: string) {
  const pre = path ? `${path}/` : ""
  for await (const e of tarEntries(p.stdout!)) {
    if (e.type !== "file" || !e.name.startsWith(pre)) continue
    yield { name: e.name.slice(pre.length), lastModified: new Date(e.mtime * 1000), input: e.data() }
  }
}

// A file as it was, or a folder as a zip, streamed from the repository. close() stops restic if the client goes away.
export function openDownload(c: Ctx, path: string, folder: boolean): { name: string; stream: ReadableStream<Uint8Array>; zip: boolean; close: () => void } {
  const p = clean(path)
  const leaf = p.split("/").pop() || c.job.name
  if (c.snap.kind === "tar") {
    const proc = spawnRestic(c.job, ["dump", c.snap.resticId, `/${sourceFile(c.snap.source)}`])
    void closing(proc)
    const stream = folder ? makeZip(zipOf(proc, p)) : (Readable.toWeb(Readable.from(fileFromTar(proc, p))) as ReadableStream<Uint8Array>)
    return { name: folder ? `${leaf}.zip` : leaf, stream, zip: folder, close: () => proc.kill() }
  }
  const proc = spawnRestic(c.job, folder ? ["dump", "--archive", "zip", c.snap.resticId, `/${p}`] : ["dump", c.snap.resticId, `/${p}`])
  void closing(proc)
  return { name: folder ? `${leaf}.zip` : leaf, stream: Readable.toWeb(proc.stdout!) as ReadableStream<Uint8Array>, zip: folder, close: () => proc.kill() }
}

const clean = (p: string) => rel(p).split("/").filter((s) => s && s !== "." && s !== "..").join("/")

// ---- restoring over ssh --------------------------------------------------------------------------------------------

// To the original place (the volume, or / for folders: the tar holds the paths as they were) or into another folder on the server.
// For the original, the member types the server's name; the page asks for it, and this checks it.
export async function restoreOverSsh(userId: string, snapshotId: string, o: { target: "original" | string; confirmName?: string }): Promise<{ error?: string; bytes?: number }> {
  const c = await snapshotCtx(userId, snapshotId)
  if (!c) return { error: "That snapshot isn't here." }
  if (c.host.mode === "agent") return { error: "This server has no SSH access from Nimbus. Use the restic command on the server instead." }
  const original = o.target === "original"
  if (original && o.confirmName !== c.host.label) return { error: "Type the server's name to confirm restoring over the original." }
  if (!original && (!o.target.startsWith("/") || /[\0\n\r]/.test(o.target) || o.target.length > 1000)) return { error: "Enter an absolute folder path on the server, like /restore." }
  if (c.host.isSelf && !original) return { error: "On this Nimbus server a volume can only be restored back into itself." }
  const volume = c.snap.source.startsWith("volume:") ? c.snap.source.slice(7) : null
  const into = original ? (volume ? volumeUntar(volume) : "tar -xf - -C /") : `mkdir -p ${shq(o.target)} && tar -xf - -C ${shq(o.target)}`
  try {
    const bytes = await withTransport(c.host, async (t) => {
      const cmd = t(into)
      const dump = tarDump(c)
      const end = closing(dump)
      const dst = spawn(cmd.file, cmd.args, { stdio: ["pipe", "ignore", "pipe"] })
      let err = ""
      dst.stderr.on("data", (b: Buffer) => (err = tail(err + b, 2000)))
      let n = 0
      dump.stdout!.on("data", (b: Buffer) => (n += b.length))
      dump.stdout!.pipe(dst.stdin)
      dst.stdin.on("error", () => {})
      const code = await new Promise<number | null>((r) => (dst.on("error", () => r(null)), dst.on("close", r)))
      if (code !== 0) {
        dump.kill()
        throw new Error(err.trim().split("\n").slice(-2).join(" ") || "The server couldn't unpack the backup.")
      }
      await end
      return n
    })
    await audit("server_backup_restore_ssh", { detail: `${c.job.name} → ${original ? "original" : o.target}` })
    return { bytes }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

// ---- restoring into Files ----------------------------------------------------------------------------------------

async function ownFolder(userId: string, id: string | null) {
  if (!id) return null
  const [n] = await db.select({ id: nodes.id }).from(nodes).where(and(eq(nodes.id, id), eq(nodes.ownerId, userId), eq(nodes.kind, "folder"), isNull(nodes.trashedAt), isNull(nodes.vaultId)))
  return n?.id ?? undefined
}

const stamp = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ").replace(":", "-")

// Unpacks `path` (or everything) of a snapshot into a new folder under `folderId` (null: the top of My files).
export async function restoreToFiles(userId: string, snapshotId: string, o: { folderId: string | null; path?: string }): Promise<{ error?: string; files?: number; folderId?: string }> {
  const c = await snapshotCtx(userId, snapshotId)
  if (!c) return { error: "That snapshot isn't here." }
  const parent = await ownFolder(userId, o.folderId)
  if (parent === undefined) return { error: "Choose one of your own folders." }
  const path = clean(o.path ?? "")
  const name = `${c.job.name} ${stamp(c.snap.takenAt)}${path ? ` ${path.split("/").pop()}` : ""}`.replace(/[\\/:*?"<>|]/g, "-").slice(0, 120)
  const base = await mkdirp(db, userId, parent, [name])
  if ("error" in base) return { error: base.error }
  // Keep the chosen item's own name: strip only the folders above it.
  const strip = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : ""
  const proc = tarDump(c, c.snap.kind === "files" ? `/${path}` : "/")
  const end = closing(proc)
  const dirs = new Map<string, string>()
  let files = 0
  try {
    for await (const e of tarEntries(proc.stdout!)) {
      if (e.type !== "file" || !e.name) continue
      const inScope = c.snap.kind === "files" || !path || e.name === path || e.name.startsWith(`${path}/`)
      if (!inScope) continue
      const parts = (c.snap.kind === "files" ? e.name : e.name.slice(strip.length)).split("/").filter((s) => s && s !== "." && s !== "..")
      if (!parts.length) continue
      const fileName = parts.pop()!
      const dir = await mkdirp(db, userId, base.id, parts, dirs)
      if ("error" in dir) throw new Error(dir.error)
      const r = await storeFile({ me: userId, at: { ownerId: userId, parentId: dir.id }, name: fileName, existing: null, body: Readable.toWeb(Readable.from(e.data())) as ReadableStream<Uint8Array>, declared: e.size, prefix: "sb", quiet: true })
      // A refused file (a blocked type, no room) stops the restore: the tar can't be skipped past once part of it was read.
      if ("error" in r) throw new Error(r.error.message ?? "Couldn't store a file.")
      files++
    }
    await end
  } catch (err) {
    proc.kill()
    return { error: (err as Error).message }
  }
  await audit("server_backup_restore_files", { detail: `${c.job.name}: ${files} files` })
  return { files, folderId: base.id ?? undefined }
}

// ---- the command -------------------------------------------------------------------------------------------------

// What to run on any machine with restic: the secrets are placeholders, since Nimbus keeps the real ones sealed.
export function restoreCommand(c: Ctx): string {
  const d = dest(c.job)
  const opts = repoOpts(d).join(" ")
  const lines = [
    `export AWS_ACCESS_KEY_ID=${shq(c.job.s3AccessKey ?? "")}`,
    "export AWS_SECRET_ACCESS_KEY='<the storage secret access key>'",
    "export RESTIC_PASSWORD='<your restic repository password>'",
    `export RESTIC_REPOSITORY=${shq(repoUrl(d))}`,
    "",
    c.snap.kind === "tar"
      ? `mkdir -p ./restored && restic ${opts} dump ${c.snap.resticId} /${sourceFile(c.snap.source)} | tar -xf - -C ./restored`
      : `restic ${opts} restore ${c.snap.resticId} --target ./restored`,
  ]
  return lines.join("\n")
}

