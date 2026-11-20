// Cloud Import's runs. The worker hands a run here through /api/jobs ("import-run") and holds the request open until it is done.
// Never deletes anything in Nimbus: a file that is already here (same hash, or same size and time, or brought over by this job
// before) is skipped, and any other clash keeps both under a free name.
import "server-only"

import { and, eq, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { comments, importItems, importJobs, importRuns, nodes, fileVersions, settings, stars } from "@/lib/db/schema"
import { notify } from "@/lib/notify"
import { checkStorage } from "@/lib/quota"
import { enqueueImport, redis } from "@/lib/redis"
import { getRange, headSize } from "@/lib/s3"
import { mkdirp } from "@/lib/uploads"
import { MAX_COMMENT } from "@nimbus/shared/comments"
import { keepToken, ownConnection, guardRemote, remoteOf } from "./connections.ts"
import type { Session } from "./rclone.ts"
import { withRemote } from "./rclone.ts"
import { etaOf, isSidecar, mtimeOf, parseSidecar, sameFile, sameItem, segments, sidecarCandidates, sidecarKey, type ImportOptions, type LsEntry } from "./rules.ts"
import { saveImported } from "./save.ts"
import { openEntry, readEntries, type ZipEntry, type ZipSource } from "./zip.ts"

type Job = typeof importJobs.$inferSelect
export type Trigger = "first" | "manual" | "schedule"
export type Progress = {
  runId: string
  startedAt: string
  state: "running" | "paused"
  filesDone: number
  filesSkipped: number
  filesFailed: number
  filesTotal: number
  bytesDone: number
  bytesTotal: number
  current: string | null
  etaSec: number | null
} | null

const progressKey = (jobId: string) => `import:progress:${jobId}`
const ctlKey = (runId: string) => `import:ctl:${runId}`
const TTL = 3 * 24 * 3600

class Cancelled extends Error {}
class Failure extends Error {}

// ---- starting ----

// Opens a run and queues it, unless the job already has one going (that one's id comes back).
export async function startRun(job: Job, trigger: Trigger) {
  const [run] = await db.insert(importRuns).values({ jobId: job.id, trigger }).onConflictDoNothing().returning({ id: importRuns.id })
  if (!run) {
    const [other] = await db.select({ id: importRuns.id }).from(importRuns).where(and(eq(importRuns.jobId, job.id), eq(importRuns.status, "running")))
    return { runId: other?.id ?? "", started: false }
  }
  await redis.del(ctlKey(run.id)).catch(() => {})
  await put(job.id, { runId: run.id, startedAt: new Date().toISOString(), state: "running", filesDone: 0, filesSkipped: 0, filesFailed: 0, filesTotal: job.estFiles ?? 0, bytesDone: 0, bytesTotal: job.estBytes ?? 0, current: null, etaSec: null })
  await enqueueImport({ runId: run.id })
  return { runId: run.id, started: true }
}

const put = (jobId: string, p: NonNullable<Progress>) => redis.set(progressKey(jobId), JSON.stringify(p), "EX", TTL).catch(() => {})

export async function progressOf(jobId: string): Promise<Progress> {
  const raw = await redis.get(progressKey(jobId)).catch(() => null)
  return raw ? (JSON.parse(raw) as Progress) : null
}

// Pause, resume or cancel the job's running run. A running file finishes first (cancel stops it within a few seconds).
export async function control(jobId: string, what: "pause" | "resume" | "cancel") {
  const [run] = await db.select({ id: importRuns.id }).from(importRuns).where(and(eq(importRuns.jobId, jobId), eq(importRuns.status, "running")))
  if (!run) return false
  if (what === "resume") await redis.del(ctlKey(run.id))
  else await redis.set(ctlKey(run.id), what, "EX", TTL)
  return true
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---- running ----

type Counts = { done: number; skipped: number; failed: number; bytes: number; total: number; bytesTotal: number; errors: string[] }

export async function runImport(runId: string) {
  const [run] = await db.select().from(importRuns).where(eq(importRuns.id, runId))
  if (!run || run.status !== "running") return
  const [job] = await db.select().from(importJobs).where(eq(importJobs.id, run.jobId))
  const c: Counts = { done: 0, skipped: 0, failed: 0, bytes: 0, total: 0, bytesTotal: 0, errors: [] }
  let state: "running" | "paused" = "running"
  let current: string | null = null
  let flushed = 0
  let saved = 0
  const startedMs = run.startedAt.getTime()
  const show = async (force = false) => {
    if (!job || (!force && Date.now() - flushed < 1000)) return
    flushed = Date.now()
    const eta = etaOf(c.bytes, c.bytesTotal, startedMs, Date.now()) ?? etaOf(c.done + c.skipped + c.failed, c.total, startedMs, Date.now())
    await put(job.id, { runId, startedAt: run.startedAt.toISOString(), state, filesDone: c.done, filesSkipped: c.skipped, filesFailed: c.failed, filesTotal: c.total, bytesDone: c.bytes, bytesTotal: c.bytesTotal, current, etaSec: eta })
    await db
      .update(importRuns)
      .set({ filesTotal: c.total, filesDone: c.done, filesSkipped: c.skipped, filesFailed: c.failed, bytesTotal: c.bytesTotal, bytesDone: c.bytes })
      .where(eq(importRuns.id, runId))
  }
  // Called before each file: waits while paused, stops when cancelled.
  const gate = async () => {
    for (;;) {
      const ctl = await redis.get(ctlKey(runId)).catch(() => null)
      if (ctl === "cancel") throw new Cancelled()
      if (ctl !== "pause") break
      state = "paused"
      await show(true)
      await sleep(2000)
    }
    if (state === "paused") state = "running"
  }
  const fail = (path: string, error: string) => {
    c.failed++
    if (c.errors.length < 20) c.errors.push(`${path}: ${error}`.slice(0, 300))
  }
  let fatal = false
  let cancelled = false
  try {
    if (!job) throw new Failure("The import was deleted.")
    const [s] = await db.select({ on: settings.importToolEnabled }).from(settings)
    if (!s?.on) throw new Failure("Cloud import is turned off by an admin.")
    const [target] = job.targetNodeId
      ? await db.select({ id: nodes.id }).from(nodes).where(and(eq(nodes.id, job.targetNodeId), eq(nodes.ownerId, job.userId), eq(nodes.kind, "folder"), sql`${nodes.trashedAt} is null`))
      : []
    if (!target) throw new Failure("The target folder is gone. Choose another in Settings.")
    const ctx = { runId, job, c, gate, show, fail, target: target.id, setCurrent: (v: string | null) => ((current = v), void show()), tick: async () => { if (++saved % 25 === 0) await checkStorage(job.userId) } }
    if (job.kind === "takeout") await takeout(ctx)
    else await pull(ctx)
  } catch (e) {
    if (e instanceof Cancelled) cancelled = true
    else {
      fatal = true
      c.errors.unshift(((e as Error).message || "The import stopped.").slice(0, 300))
    }
  } finally {
    if (job) {
      await redis.del(progressKey(job.id), ctlKey(runId)).catch(() => {})
      await checkStorage(job.userId).catch(() => {})
    }
  }
  const status = cancelled ? "cancelled" : fatal || (c.failed > 0 && c.done + c.skipped === 0) ? "failed" : c.failed > 0 ? "partial" : "ok"
  await db
    .update(importRuns)
    .set({ status, filesTotal: Math.max(c.total, c.done + c.skipped + c.failed), filesDone: c.done, filesSkipped: c.skipped, filesFailed: c.failed, bytesTotal: Math.max(c.bytesTotal, c.bytes), bytesDone: c.bytes, errors: c.errors, finishedAt: new Date() })
    .where(eq(importRuns.id, runId))
  if (job) await settle(job, status, c)
}

// After a run: the streak, the next due time, the alert (bell + email) at two failures in a row on a scheduled import,
// and the one-time "import finished" bell. The alert is claimed first so a retry can't send it twice.
async function settle(job: Job, status: "ok" | "partial" | "failed" | "cancelled", c: Counts) {
  const streak = status === "failed" ? job.failStreak + 1 : status === "cancelled" ? job.failStreak : 0
  await db
    .update(importJobs)
    .set({
      lastRunAt: new Date(),
      lastStatus: status,
      failStreak: streak,
      nextDueAt: job.intervalMin ? sql`now() + make_interval(mins => ${job.intervalMin})` : null,
      ...(status === "ok" && { alertedAt: null }),
    })
    .where(eq(importJobs.id, job.id))
  const href = `/more/import?job=${job.id}&tab=history`
  if (streak >= 2 && job.intervalMin && !job.alertedAt) {
    const [claimed] = await db.update(importJobs).set({ alertedAt: new Date() }).where(and(eq(importJobs.id, job.id), sql`${importJobs.alertedAt} is null`)).returning({ id: importJobs.id })
    if (claimed) await notify(job.userId, "import_failed", { data: { name: job.name, streak: String(streak), error: c.errors[0] ?? "", href } })
  }
  if ((status === "ok" || status === "partial") && c.done > 0 && !job.doneNotified) {
    const [claimed] = await db.update(importJobs).set({ doneNotified: true }).where(and(eq(importJobs.id, job.id), eq(importJobs.doneNotified, false))).returning({ id: importJobs.id })
    if (claimed) await notify(job.userId, "import_done", { data: { name: job.name, files: String(c.done), skipped: String(c.skipped), href: `/more/import?job=${job.id}` } })
  }
}

type Ctx = {
  runId: string
  job: Job
  c: Counts
  gate: () => Promise<void>
  show: (force?: boolean) => Promise<void>
  fail: (path: string, error: string) => void
  target: string
  setCurrent: (v: string | null) => void
  tick: () => Promise<void>
}

// ---- one file ----

type Incoming = {
  // The path this job knows the file by.
  sourcePath: string
  sourceId: string | null
  entry: LsEntry
  dir: string[]
  name: string
  open: () => { stream: import("node:stream").Readable; kill: () => void } | Promise<{ stream: import("node:stream").Readable; kill: () => void }>
  mtime: Date | null
  taken?: boolean
  starred?: boolean
  description?: string
}

async function bring(x: Ctx, dirs: Map<string, string>, f: Incoming) {
  const { job, c } = x
  const opts = job.options as ImportOptions
  x.setCurrent(f.sourcePath)
  const size = Math.max(0, f.entry.Size)
  const [item] = await db.select().from(importItems).where(and(eq(importItems.jobId, job.id), eq(importItems.sourcePath, f.sourcePath)))
  const settleItem = (status: "imported" | "skipped" | "failed", nodeId: string | null, error: string | null) =>
    db
      .insert(importItems)
      .values({ jobId: job.id, sourcePath: f.sourcePath, sourceId: f.sourceId, nodeId, size, mtime: f.mtime, status, error })
      .onConflictDoUpdate({ target: [importItems.jobId, importItems.sourcePath], set: { sourceId: f.sourceId, nodeId, size, mtime: f.mtime, status, error, updatedAt: new Date() } })
  if (item && item.status !== "failed" && sameItem(f.entry, item)) {
    c.skipped++
    c.bytes += size
    return
  }
  try {
    const made = await mkdirp(db, job.userId, x.target, f.dir, dirs)
    if ("error" in made) throw new Error(made.error)
    const parent = made.id
    const [same] = await db
      .select({ id: nodes.id, size: nodes.size, updatedAt: nodes.updatedAt, sha256: fileVersions.sha256, etag: fileVersions.etag })
      .from(nodes)
      .leftJoin(fileVersions, eq(fileVersions.id, nodes.currentVersionId))
      .where(and(eq(nodes.ownerId, job.userId), parent ? eq(nodes.parentId, parent) : sql`${nodes.parentId} is null`, sql`lower(${nodes.name}) = lower(${f.name})`, eq(nodes.kind, "file"), sql`${nodes.trashedAt} is null`))
    if (same && sameFile(f.entry, { size: same.size, sha256: same.sha256, etag: same.etag, mtime: same.updatedAt })) {
      await settleItem("skipped", same.id, null)
      c.skipped++
      c.bytes += size
      return
    }
    const src = await f.open()
    // Cancelling while a big file downloads stops it within a couple of seconds.
    const watch = setInterval(() => void redis.get(ctlKey(x.runId)).then((v) => v === "cancel" && src.kill()).catch(() => {}), 2000)
    const r = await saveImported({ userId: job.userId, parentId: parent, name: f.name, stream: src.stream, declared: f.entry.Size >= 0 ? f.entry.Size : null, mtime: opts.keepDates || f.taken ? f.mtime : null, taken: f.taken }).finally(() => clearInterval(watch))
    if ("error" in r) throw new Error(r.error)
    await settleItem("imported", r.nodeId, null)
    if (f.starred) await db.insert(stars).values({ userId: job.userId, nodeId: r.nodeId }).onConflictDoNothing()
    if (f.description) await db.insert(comments).values({ nodeId: r.nodeId, authorId: job.userId, body: f.description.slice(0, MAX_COMMENT) })
    c.done++
    c.bytes += r.size
    await x.tick()
  } catch (e) {
    const msg = (e as Error).message || "Couldn't import this file."
    // A cancel kills rclone, which shows up here as a failed file.
    await x.gate()
    await settleItem("failed", null, msg.slice(0, 300)).catch(() => {})
    x.fail(f.sourcePath, msg)
  }
}

// ---- rclone sources ----

async function pull(x: Ctx) {
  const { job, c } = x
  const conn = job.connectionId ? await ownConnection(job.userId, job.connectionId) : null
  if (!conn) throw new Failure("The connection for this import was deleted.")
  const remote = remoteOf(conn)
  await guardRemote(remote)
  const opts = job.options as ImportOptions
  const drive = conn.provider === "gdrive"
  const passes = [
    ...job.sources.map((path) => ({ path, shared: false, prefix: [] as string[] })),
    ...(drive && opts.sharedWithMe ? [{ path: "", shared: true, prefix: ["Shared with me"] }] : []),
  ]
  await withRemote(
    remote,
    async (rc: Session) => {
      const lists: { pass: (typeof passes)[number]; entries: LsEntry[] }[] = []
      for (const pass of passes) {
        await x.gate()
        x.setCurrent(`Listing ${pass.path || "everything"}…`)
        const entries = await rc.list(pass.path, { metadata: drive && (opts.stars || opts.descriptions), sharedWithMe: pass.shared })
        lists.push({ pass, entries })
        c.total += entries.length
        c.bytesTotal += entries.reduce((n, e) => n + Math.max(0, e.Size), 0)
      }
      await x.show(true)
      const dirs = new Map<string, string>()
      for (const { pass, entries } of lists) {
        const root = segments(pass.path).at(-1)
        for (const entry of entries) {
          await x.gate()
          const parts = segments(entry.Path)
          const name = parts.pop() ?? entry.Name
          const full = [pass.shared ? "shared:" : "", pass.path, entry.Path].filter(Boolean).join("/")
          const meta = entry.Metadata ?? {}
          await bring(x, dirs, {
            sourcePath: full,
            sourceId: entry.ID ?? null,
            entry,
            dir: opts.mirror ? [...pass.prefix, ...(root ? [root] : []), ...parts] : pass.prefix,
            name,
            open: () => rc.cat([pass.path, entry.Path].filter(Boolean).join("/"), { sharedWithMe: pass.shared }),
            mtime: mtimeOf(entry),
            starred: opts.stars && meta.starred === "true",
            description: opts.descriptions ? (meta.description ?? "").trim() : "",
          })
          await x.show()
        }
      }
    },
    keepToken(conn.id)
  )
}

// ---- Takeout zips ----

// A zip in Files, read by range from its bucket object.
async function zipSource(userId: string, nodeId: string): Promise<{ name: string; src: ZipSource }> {
  const [n] = await db
    .select({ name: nodes.name, key: nodes.s3Key, enc: fileVersions.encKey })
    .from(nodes)
    .leftJoin(fileVersions, eq(fileVersions.id, nodes.currentVersionId))
    .where(and(eq(nodes.id, nodeId), eq(nodes.ownerId, userId), eq(nodes.kind, "file"), sql`${nodes.trashedAt} is null`, sql`${nodes.vaultId} is null`))
  if (!n?.key || n.enc) throw new Failure("A zip you picked is gone, or is in a vault.")
  const size = await headSize(n.key)
  if (!size) throw new Failure(`“${n.name}” is empty.`)
  const key = n.key
  return {
    name: n.name,
    src: { size, range: async (a, b) => (await getRange(key, `bytes=${a}-${b - 1}`)).body as unknown as AsyncIterable<Uint8Array> },
  }
}

async function readText(src: ZipSource, e: ZipEntry) {
  const parts: Buffer[] = []
  let n = 0
  for await (const ch of await openEntry(src, e)) {
    n += ch.length
    if (n > 2 * 1024 * 1024) return ""
    parts.push(ch)
  }
  return Buffer.concat(parts).toString("utf8")
}

async function takeout(x: Ctx) {
  const { job, c } = x
  const opts = job.options as ImportOptions
  const dirs = new Map<string, string>()
  const zips = []
  for (const id of job.sources) {
    await x.gate()
    x.setCurrent("Reading the zip…")
    const z = await zipSource(job.userId, id)
    const all = await readEntries(z.src)
    const files = all.filter((e) => !e.dir)
    const claimed = new Set(files.filter((e) => !/\.json$/i.test(e.name)).flatMap((e) => sidecarCandidates(e.name)))
    const media = files.filter((e) => !isSidecar(e.name, claimed))
    const json = new Map(files.filter((e) => /\.json$/i.test(e.name)).map((e) => [sidecarKey(e.name), e]))
    zips.push({ id, z, media, json })
    c.total += media.length
    c.bytesTotal += media.reduce((n, e) => n + e.size, 0)
  }
  await x.show(true)
  for (const { id, z, media, json } of zips) {
    for (const e of media) {
      await x.gate()
      const side = sidecarCandidates(e.name).map((k) => json.get(k)).find(Boolean)
      const meta = side ? parseSidecar(await readText(z.src, side).catch(() => "")) : null
      const parts = segments(e.name.replace(/^Takeout\//i, ""))
      const name = parts.pop()!
      await bring(x, dirs, {
        sourcePath: `zip:${id}/${e.name}`,
        sourceId: null,
        entry: { Path: e.name, Name: name, Size: e.size, ModTime: meta?.taken?.toISOString() ?? "", IsDir: false },
        dir: opts.mirror ? parts : [],
        name,
        open: async () => {
          const stream = await openEntry(z.src, e)
          return { stream, kill: () => stream.destroy(new Error("Cancelled.")) }
        },
        mtime: meta?.taken ?? null,
        taken: true,
        starred: opts.stars && meta?.starred,
        description: opts.descriptions ? meta?.description : "",
      })
      await x.show()
    }
  }
}
