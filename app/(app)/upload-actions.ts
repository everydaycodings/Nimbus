"use server"

import { and, eq, isNull, sql } from "drizzle-orm"
import { refresh } from "next/cache"

import { db } from "@/lib/db"
import { fileVersions, nodes } from "@/lib/db/schema"
import { accessOne, atLeast, folderOwner, viewable } from "@/lib/access"
import { markOpened, openableFile, UUID } from "@/lib/files"
import { formatBytes } from "@/lib/file-rules"
import { officeAction, signWopi } from "@/lib/office"
import { spaceLeft } from "@/lib/quota"
import { presignGet } from "@/lib/s3"
import { freeName, signUploadToken, splitPath } from "@/lib/upload-rules"
import {
  addVersion,
  deleteUnreferenced,
  finishTusUpload,
  isOpenFolder,
  mkdirp,
  rejectReason,
  uploadLimits,
  versionsOf,
  zipTree,
} from "@/lib/uploads"
import { requireMember } from "@/lib/session"

// Contract for Phase 5 uploads. The backend fills these in; the UI calls them.

export type UploadEntry = {
  // Relative to the target folder, "/"-separated: "a.jpg" or "Photos/2024/a.jpg".
  path: string
  size: number
  // An empty folder from a folder upload.
  dir?: boolean
}

export type Conflict = {
  path: string
  kind: "file" | "folder"
  // Suggested name for "Keep both", e.g. "a (1).jpg" or "Photos (1)".
  freeName: string
}

export type Plan = {
  error?: string
  // Signed, sent as tus metadata `token`. Binds the user and the target folder.
  token?: string
  // Same-name files anywhere in the upload, and same-name top-level folders.
  conflicts: Conflict[]
  // Refused before any bytes move: too big or a blocked extension.
  rejected: { path: string; reason: string }[]
}

const MAX_ENTRIES = 10_000
const GONE = "That folder is gone. Refresh and try again."
const BAD_NAME =
  "Names can't be blank, . or .., contain \\ or run past 255 characters."
const ROOT = "00000000-0000-0000-0000-000000000000"

// The owner of the folder being added to, when the user may add to it.
const parentOwner = async (userId: string, parentId: string | null) => {
  const owner = await folderOwner(userId, parentId)
  return owner && (await isOpenFolder(owner, parentId)) ? owner : null
}

export async function planUpload(
  parentId: string | null,
  entries: UploadEntry[]
): Promise<Plan> {
  const me = await requireMember()
  const plan: Plan = { conflicts: [], rejected: [] }
  if (!Array.isArray(entries) || entries.length > MAX_ENTRIES)
    return { ...plan, error: "Upload at most 10,000 items at a time." }
  // Uploads into a shared folder belong to, and count against, its owner.
  const owner = await parentOwner(me.id, parentId)
  if (!owner) return { ...plan, error: GONE }

  const limits = await uploadLimits()
  const files: { path: string; names: string[]; size: number }[] = []
  // Top-level folders in the upload, lowercased → as typed.
  const tops = new Map<string, string>()
  // Names the upload itself puts in each of its folders, so "Keep both" avoids them.
  const batch = new Map<string, Set<string>>()
  for (const e of entries) {
    const names = splitPath(e?.path)
    if (!names) {
      plan.rejected.push({ path: String(e?.path), reason: BAD_NAME })
      continue
    }
    const path = names.join("/")
    if (names.length > 1 || e.dir) tops.set(names[0].toLowerCase(), names[0])
    const dir = names.slice(0, -1).join("/").toLowerCase()
    batch.set(
      dir,
      (batch.get(dir) ?? new Set()).add(names.at(-1)!.toLowerCase())
    )
    if (e.dir) continue
    const size = Number(e.size) || 0
    const reason = rejectReason(names.at(-1)!, size, limits)
    if (reason) plan.rejected.push({ path, reason })
    else files.push({ path, names, size })
  }

  const left = await spaceLeft(owner)
  const need = files.reduce((n, f) => n + f.size, 0)
  if (left !== null && need > left)
    return {
      ...plan,
      error: `This upload needs ${formatBytes(need)}, but only ${formatBytes(left)} is left in ${owner === me.id ? "your storage" : "the owner's storage"}.`,
    }

  // Existing untrashed nodes, keyed "<folder id or root>/<lowercased name>".
  const known = new Map<string, { id: string; kind: "file" | "folder" }>()
  const at = (folder: string | null, name: string) =>
    `${folder ?? ROOT}/${name.toLowerCase()}`
  const lookup = async (pairs: [string | null, string][]) => {
    if (!pairs.length) return
    const folders = [...new Set(pairs.map(([f]) => f ?? ROOT))]
    const names = [...new Set(pairs.map(([, n]) => n.toLowerCase()))]
    const rows = await db
      .select({
        id: nodes.id,
        parentId: nodes.parentId,
        kind: nodes.kind,
        name: nodes.name,
      })
      .from(nodes)
      .where(
        and(
          eq(nodes.ownerId, owner),
          isNull(nodes.trashedAt),
          sql`coalesce(${nodes.parentId}, ${ROOT}) in ${folders}`,
          sql`lower(${nodes.name}) in ${names}`
        )
      )
    for (const r of rows) known.set(at(r.parentId, r.name), r)
  }

  await lookup([...tops.values()].map((n) => [parentId, n]))
  const folderClashes = [...tops.values()].filter((n) =>
    known.has(at(parentId, n))
  )

  // Walk the files' paths one level at a time through existing folders.
  const fileClashes: {
    path: string
    folder: string | null
    dir: string
    name: string
  }[] = []
  const cur: (string | null | undefined)[] = files.map(() => parentId)
  for (let d = 0; ; d++) {
    const ask: [string | null, string][] = []
    files.forEach((f, i) => {
      if (cur[i] !== undefined && d < f.names.length)
        ask.push([cur[i]!, f.names[d]])
    })
    if (!ask.length) break
    await lookup(ask)
    files.forEach((f, i) => {
      if (cur[i] === undefined || d >= f.names.length) return
      const hit = known.get(at(cur[i]!, f.names[d]))
      if (d === f.names.length - 1) {
        if (hit?.kind === "file")
          fileClashes.push({
            path: f.path,
            folder: cur[i]!,
            dir: f.names.slice(0, -1).join("/").toLowerCase(),
            name: f.names[d],
          })
        cur[i] = undefined
      } else cur[i] = hit?.kind === "folder" ? hit.id : undefined
    })
  }

  // Everything already in the folders that have clashes, for "Keep both" names.
  const clashFolders = [
    ...new Set([
      ...fileClashes.map((c) => c.folder ?? ROOT),
      ...(folderClashes.length ? [parentId ?? ROOT] : []),
    ]),
  ]
  const taken = new Map<string, Set<string>>()
  if (clashFolders.length) {
    const rows = await db
      .select({
        folder: sql<string>`coalesce(${nodes.parentId}, ${ROOT})`,
        name: sql<string>`lower(${nodes.name})`,
      })
      .from(nodes)
      .where(
        and(
          eq(nodes.ownerId, owner),
          isNull(nodes.trashedAt),
          sql`coalesce(${nodes.parentId}, ${ROOT}) in ${clashFolders}`
        )
      )
    for (const r of rows)
      taken.set(r.folder, (taken.get(r.folder) ?? new Set()).add(r.name))
  }
  const takenIn = (folder: string | null, dir: string) =>
    new Set([...(taken.get(folder ?? ROOT) ?? []), ...(batch.get(dir) ?? [])])

  const topTaken = new Set([...takenIn(parentId, ""), ...tops.keys()])
  for (const name of folderClashes)
    plan.conflicts.push({
      path: name,
      kind: "folder",
      freeName: freeName(name, topTaken, true),
    })
  for (const c of fileClashes)
    plan.conflicts.push({
      path: c.path,
      kind: "file",
      freeName: freeName(c.name, takenIn(c.folder, c.dir)),
    })

  return {
    ...plan,
    token: signUploadToken(
      owner,
      parentId,
      Date.now(),
      owner === me.id ? {} : { b: me.id }
    ),
  }
}

// Makes these folders (mkdir -p, relative to parentId), reusing existing ones.
// Used for empty folders in a folder upload.
export async function createFolders(
  parentId: string | null,
  paths: string[]
): Promise<{ error?: string }> {
  const me = await requireMember()
  if (!Array.isArray(paths) || paths.length > MAX_ENTRIES)
    return { error: "Upload at most 10,000 items at a time." }
  const owner = await parentOwner(me.id, parentId)
  if (!owner) return { error: GONE }
  const cache = new Map<string, string>()
  for (const p of paths) {
    const names = splitPath(p)
    if (!names) return { error: BAD_NAME }
    const made = await mkdirp(db, owner, parentId, names, cache)
    if ("error" in made) return made
  }
  refresh()
  return {}
}

// Idempotent: turns a finished tus upload into a node or a new version. The
// tusd post-finish hook calls the same logic, so whichever runs first wins.
export async function finishUpload(
  uploadUrl: string
): Promise<{ error?: string; nodeId?: string; versionId?: string }> {
  const me = await requireMember()
  let id = ""
  try {
    id = decodeURIComponent(
      new URL(uploadUrl, "http://x").pathname
        .split("/")
        .filter(Boolean)
        .pop() ?? ""
    )
  } catch {}
  const done = await finishTusUpload(id, { user: me.id })
  if (done.nodeId) {
    await markOpened(me.id, done.nodeId)
    refresh()
  }
  return done
}

export type Version = {
  id: string
  // v1, v2, … in upload order.
  number: number
  size: number
  mime: string | null
  createdAt: string
  uploadedBy: string | null
  note: string | null
  // Kept forever: automatic pruning skips it.
  keep: boolean
  current: boolean
}

const GONE_VERSION = "That version is gone. Refresh and try again."

export async function listVersions(nodeId: string): Promise<Version[]> {
  const me = await requireMember()
  if (!(await editsFile(me.id, nodeId))) return []
  const rows = await versionsOf(nodeId)
  return rows.map((v) => ({
    id: v.id,
    number: v.number,
    size: v.size,
    mime: v.mime,
    createdAt: v.createdAt.toISOString(),
    uploadedBy: v.uploadedBy,
    note: v.note,
    keep: v.keep,
    current: v.current,
  }))
}

// Points the file at this version, older or newer. Nothing is copied or lost,
// so switching back is the same call with the other version.
export async function makeCurrent(
  versionId: string
): Promise<{ error?: string }> {
  const me = await requireMember()
  const v = await editableVersion(me.id, versionId)
  if (!v) return { error: GONE_VERSION }
  if (v.current) return {}
  await db
    .update(nodes)
    .set({
      currentVersionId: v.id,
      s3Key: v.s3Key,
      size: v.size,
      mime: v.mime,
      updatedAt: new Date(),
    })
    .where(eq(nodes.id, v.nodeId))
  refresh()
  return {}
}

export async function deleteVersion(
  versionId: string
): Promise<{ error?: string }> {
  const me = await requireMember()
  const v = await editableVersion(me.id, versionId)
  if (!v) return { error: GONE_VERSION }
  if (v.current)
    return { error: "Make another version current before deleting this one." }
  await db.delete(fileVersions).where(eq(fileVersions.id, v.id))
  await deleteUnreferenced([v.s3Key])
  refresh()
  return {}
}

export async function setVersionNote(
  versionId: string,
  raw: string
): Promise<{ error?: string }> {
  const me = await requireMember()
  const note = String(raw ?? "").trim()
  if (note.length > 200) return { error: "Keep notes under 200 characters." }
  const v = await editableVersion(me.id, versionId)
  if (!v) return { error: GONE_VERSION }
  await db
    .update(fileVersions)
    .set({ note: note || null })
    .where(eq(fileVersions.id, v.id))
  return {}
}

export async function setVersionKeep(
  versionId: string,
  keep: boolean
): Promise<{ error?: string }> {
  const me = await requireMember()
  const v = await editableVersion(me.id, versionId)
  if (!v) return { error: GONE_VERSION }
  await db
    .update(fileVersions)
    .set({ keep: Boolean(keep) })
    .where(eq(fileVersions.id, v.id))
  return {}
}

// Saves a version as its own file next to the original, named "report (v3).pdf".
// It shares the stored object, so it takes no extra space.
export async function copyVersion(
  versionId: string
): Promise<{ error?: string; name?: string }> {
  const me = await requireMember()
  const v = await editableVersion(me.id, versionId)
  if (!v) return { error: GONE_VERSION }
  if (v.trashedAt) return { error: "Restore the file from the trash first." }
  const dot = v.name.lastIndexOf(".")
  const [base, ext] =
    dot > 0 ? [v.name.slice(0, dot), v.name.slice(dot)] : [v.name, ""]
  const wanted = `${base} (v${v.number})${ext}`
  const name = await db.transaction(async (tx) => {
    const taken = await tx
      .select({ name: sql<string>`lower(${nodes.name})` })
      .from(nodes)
      .where(
        and(
          eq(nodes.ownerId, v.ownerId),
          v.parentId ? eq(nodes.parentId, v.parentId) : isNull(nodes.parentId),
          isNull(nodes.trashedAt)
        )
      )
    const names = new Set(taken.map((t) => t.name))
    const free = names.has(wanted.toLowerCase())
      ? freeName(wanted, names)
      : wanted
    const [node] = await tx
      .insert(nodes)
      .values({
        ownerId: v.ownerId,
        parentId: v.parentId,
        kind: "file",
        name: free,
        size: v.size,
        mime: v.mime,
        s3Key: v.s3Key,
      })
      .returning({ id: nodes.id })
    const copy = await addVersion(tx, node.id, {
      s3Key: v.s3Key,
      size: v.size,
      mime: v.mime,
      thumb: v.thumb,
      uploadedBy: me.id,
    })
    await tx
      .update(nodes)
      .set({ currentVersionId: copy.id })
      .where(eq(nodes.id, node.id))
    return free
  })
  refresh()
  return { name }
}

export type ZipManifest = {
  name: string
  entries: { path: string; url: string; size: number; modified: string }[]
  // Empty folders, so the zip keeps the tree.
  dirs: string[]
}

// For the in-browser zip fallback: presigned URLs for everything under `ids`.
export async function zipManifest(ids: string[]): Promise<ZipManifest> {
  const me = await requireMember()
  const clean = Array.isArray(ids)
    ? ids.filter((id) => UUID.test(id)).slice(0, 1000)
    : []
  const tree = await zipTree(await viewable(me.id, clean))
  if (!tree) return { name: "Nimbus files.zip", entries: [], dirs: [] }
  return {
    name: tree.name,
    entries: await Promise.all(
      tree.files.map(async (f) => ({
        path: f.path,
        url: await presignGet(f.key, f.path.split("/").pop()!, {
          expiresIn: 12 * 3600,
        }),
        size: f.size,
        modified: f.modified.toISOString(),
      }))
    ),
    dirs: tree.dirs,
  }
}

// Owners and editors manage a file's versions.
async function editsFile(userId: string, nodeId: string) {
  if (typeof nodeId !== "string" || !UUID.test(nodeId)) return false
  const a = await accessOne(userId, nodeId)
  return a?.kind === "file" && atLeast(a.role, "editor")
}

// The version if the user can manage its file, with what the actions need.
async function editableVersion(userId: string, versionId: string) {
  if (typeof versionId !== "string" || !UUID.test(versionId)) return null
  const [v] = await db
    .select({
      id: fileVersions.id,
      nodeId: fileVersions.nodeId,
      number: fileVersions.number,
      s3Key: fileVersions.s3Key,
      size: fileVersions.size,
      mime: fileVersions.mime,
      thumb: fileVersions.thumb,
      name: nodes.name,
      ownerId: nodes.ownerId,
      parentId: nodes.parentId,
      trashedAt: nodes.trashedAt,
      current: sql<boolean>`${fileVersions.id} = ${nodes.currentVersionId}`,
    })
    .from(fileVersions)
    .innerJoin(nodes, eq(nodes.id, fileVersions.nodeId))
    .where(eq(fileVersions.id, versionId))
  return v && (await editsFile(userId, v.nodeId)) ? v : null
}

// A short-lived direct S3 URL for the previewer. PDFs come inline so the
// browser's viewer can show them; everything else is read by fetch or media
// elements, which ignore the disposition.
// `open`: someone is looking at it (Recent), not just drawing its thumbnail.
export async function previewUrl(
  id: string,
  v?: string | null,
  open = false
): Promise<string | null> {
  const me = await requireMember()
  const file = await openableFile(me.id, id, v)
  if (!file) return null
  if (open) await markOpened(me.id, id)
  const pdf = file.mime === "application/pdf"
  return presignGet(file.key, file.name, {
    inline: pdf,
    type: pdf ? "application/pdf" : undefined,
  })
}

// Collabora's viewer for an office file, or null to use the built-in viewers.
export async function officeFrame(
  id: string,
  v?: string | null
): Promise<{ action: string; token: string } | null> {
  const me = await requireMember()
  const file = await openableFile(me.id, id, v)
  if (!file) return null
  const action = await officeAction(file.name, id)
  if (action) await markOpened(me.id, id)
  return action ? { action, token: signWopi(me.id, id, v ?? null) } : null
}
