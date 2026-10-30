// One function per WebDAV method. Every change goes through the same helpers
// as the web app, so access, quotas, versions, trash and notifications match.
import "server-only"

import { randomBytes, randomUUID } from "node:crypto"

import { and, eq, ne, sql } from "drizzle-orm"
import { lookup } from "mime-types"

import { atLeast } from "@/lib/access"
import {
  ancestors,
  blocking,
  dropLock,
  getLocks,
  heldTokens,
  setLock,
} from "@/lib/dav/locks"
import { list, PREFIX, resolve, type Place, type Row } from "@/lib/dav/paths"
import type { DavUser } from "@/lib/dav/auth"
import {
  href,
  ifHolds,
  ifTokens,
  lockDiscovery,
  lockOwner,
  multistatus,
  parseIf,
  patchedProps,
  proppatchReply,
  timeout,
  type Entry,
  type Lock,
} from "@/lib/dav/xml"
import { db } from "@/lib/db"
import { fileVersions, nodes } from "@/lib/db/schema"
import { isDropped, isJunk, mimeOf } from "@/lib/file-rules"
import { notifyEdit } from "@/lib/notify"
import { getUsage, spaceLeft } from "@/lib/quota"
import { getRange, putObject, putStream } from "@/lib/s3"
import {
  CLASH,
  GONE,
  createFolderAs,
  moveAs,
  renameAs,
  trashAs,
} from "@/lib/tree-ops"
import {
  addVersion,
  deleteNodes,
  deleteUnreferenced,
  pruneVersions,
  rejectReason,
  saveUploaded,
  uploadLimits,
} from "@/lib/uploads"

export type Ctx = { me: DavUser; names: string[]; req: Request }

const say = (status: number, body?: string, headers?: HeadersInit) =>
  new Response(body ?? null, { status, headers })

const xml = (status: number, body: string, headers?: HeadersInit) =>
  say(status, body, { "Content-Type": 'application/xml; charset="utf-8"', ...headers })

// tree-ops answers in words; WebDAV wants a status.
const statusOf = (error: string) =>
  error === GONE ? 409 : error === CLASH ? 405 : 403

const mimeFor = (name: string) => lookup(name) || "application/octet-stream"

const typeOf = (n: Row) => {
  const m = mimeOf(n.mime, n.name)
  return m && m !== "application/octet-stream" ? m : mimeFor(n.name)
}

// Where a new item named in `parent` goes, or why it can't.
function target(me: DavUser, parent: Place | null) {
  if (me.readOnly) return { status: 403 }
  if (!parent) return { status: 409 }
  if (parent.kind === "root") return { ownerId: me.id, parentId: null }
  if (parent.kind !== "node") return { status: 403 }
  if (parent.node.kind !== "folder") return { status: 409 }
  if (!atLeast(parent.role, "editor")) return { status: 403 }
  return { ownerId: parent.node.ownerId, parentId: parent.node.id }
}

// The If header has to hold for the node a request changes (412 if not), and
// that node can't be locked by someone without the token (423).
// `target`: the If header is about this node, not just a folder around it.
async function locked(c: Ctx, id: string | null, deep = false, target = true) {
  const h = c.req.headers.get("if")
  if (target && h && !(await ifHoldsFor(h, id))) return say(412)
  if (!id) return null
  const l = await blocking(id, ifTokens(h), deep)
  return l ? say(423) : null
}

async function ifHoldsFor(h: string, id: string | null) {
  const [n] = id
    ? await db
        .select({ v: nodes.currentVersionId, kind: nodes.kind })
        .from(nodes)
        .where(eq(nodes.id, id))
    : []
  return ifHolds(parseIf(h), await heldTokens(id), n?.kind === "file" ? (n.v ?? id!) : undefined)
}

function entry(names: string[], name: string, place: Place): Entry {
  const now = new Date()
  if (place.kind !== "node")
    return { href: href(PREFIX, names, true), name, folder: true, created: now, modified: now }
  const n = place.node
  const folder = n.kind === "folder"
  return {
    href: href(PREFIX, names, folder),
    name,
    folder,
    size: n.size,
    mime: folder ? null : typeOf(n),
    created: n.createdAt,
    modified: n.updatedAt,
    etag: folder ? undefined : (n.currentVersionId ?? n.id),
  }
}

export function options() {
  return say(200, undefined, {
    DAV: "1, 2",
    "MS-Author-Via": "DAV",
    Allow:
      "OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, MKCOL, COPY, MOVE, LOCK, UNLOCK",
  })
}

export async function propfind(c: Ctx) {
  const depth = c.req.headers.get("depth") ?? "1"
  if (depth === "infinity")
    return xml(
      403,
      '<?xml version="1.0" encoding="utf-8"?><D:error xmlns:D="DAV:"><D:propfind-finite-depth/></D:error>'
    )
  const { place } = await resolve(c.me.id, c.names)
  if (!place) return say(404)
  const self = entry(c.names, c.names.at(-1) ?? "", place)
  const entries = [self]
  if (!c.names.length) {
    const { used } = await getUsage(c.me.id)
    self.quota = { used, available: await spaceLeft(c.me.id) }
  }
  if (depth === "1" && self.folder)
    for (const ch of await list(c.me.id, place))
      entries.push(entry([...c.names, ch.name], ch.name, ch.place))
  // Locks show on the entry asked about; children's when they're asked about.
  if (place.kind === "node")
    self.lock = (await getLocks([place.node.id])).get(place.node.id) ?? null
  return xml(207, multistatus(entries))
}

export async function proppatch(c: Ctx) {
  const { place } = await resolve(c.me.id, c.names)
  if (!place) return say(404)
  if (place.kind === "node") {
    const no = await locked(c, place.node.id)
    if (no) return no
  }
  const names = patchedProps(await c.req.text())
  return xml(207, proppatchReply(href(PREFIX, c.names, place.kind !== "node" || place.node.kind === "folder"), names))
}

export async function get(c: Ctx, head: boolean) {
  const { place } = await resolve(c.me.id, c.names)
  if (!place) return say(404)
  if (place.kind !== "node" || place.node.kind === "folder") {
    const items = await list(c.me.id, place)
    return say(200, head ? undefined : items.map((i) => i.name).join("\n") + "\n", {
      "Content-Type": "text/plain; charset=utf-8",
    })
  }
  const n = place.node
  const etag = `"${n.currentVersionId ?? n.id}"`
  const headers: Record<string, string> = {
    "Content-Type": typeOf(n),
    ETag: etag,
    "Last-Modified": n.updatedAt.toUTCString(),
    "Accept-Ranges": "bytes",
  }
  if (c.req.headers.get("if-none-match") === etag) return say(304, undefined, headers)
  if (head) return say(200, undefined, { ...headers, "Content-Length": String(n.size) })
  const range = c.req.headers.get("range") ?? undefined
  // An empty object can't be fetched with a range.
  if (!n.size) return say(200, "", { ...headers, "Content-Length": "0" })
  try {
    const r = await getRange(n.s3Key!, range)
    if (r.contentRange) headers["Content-Range"] = r.contentRange
    if (r.length !== undefined) headers["Content-Length"] = String(r.length)
    return new Response(r.body, { status: r.contentRange && range ? 206 : 200, headers })
  } catch (e) {
    if ((e as { name?: string }).name === "InvalidRange")
      return say(416, undefined, { "Content-Range": `bytes */${n.size}` })
    throw e
  }
}

// Counts bytes on the way to S3 and stops past `max`.
function capped(body: ReadableStream<Uint8Array>, max: number | null) {
  let seen = 0
  const over = { hit: false }
  const stream = body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctl) {
        seen += chunk.byteLength
        if (max !== null && seen > max) {
          over.hit = true
          ctl.error(new Error("too big"))
        } else ctl.enqueue(chunk)
      },
    })
  )
  return { stream, over, size: () => seen }
}

// Stores bytes as a new file in the folder, or a new version of the file with
// that name. An empty current version (clients often create a file empty, then
// write it) is replaced rather than kept as history.
async function store(
  c: Ctx,
  at: { ownerId: string; parentId: string | null },
  name: string,
  existing: Row | null,
  body: ReadableStream<Uint8Array> | null
) {
  const limits = await uploadLimits()
  // Chunked uploads don't say their size; they're counted as they stream.
  const raw = c.req.headers.get("content-length")
  const known = raw !== null && Number.isFinite(Number(raw))
  const declared = known ? Number(raw) : 0
  const why = rejectReason(name, declared, limits)
  if (why) {
    const tooBig = limits.maxUploadBytes !== null && declared > limits.maxUploadBytes
    return say(tooBig ? 413 : 403, why)
  }
  const left = await spaceLeft(at.ownerId)
  if (left !== null && declared > left) return say(507, "Storage is full.")

  const key = `dav-${randomBytes(16).toString("hex")}`
  const mime = mimeFor(name)
  let size = 0
  if (body && !(known && declared === 0)) {
    const max = Math.min(left ?? Infinity, limits.maxUploadBytes ?? Infinity)
    const counted = capped(body, Number.isFinite(max) ? max : null)
    try {
      await putStream(key, counted.stream, mime)
    } catch (e) {
      if (counted.over.hit)
        return say(left !== null && counted.size() > left ? 507 : 413)
      throw e
    }
    size = counted.size()
  } else await putObject(key, new Uint8Array(), mime)

  const before = existing?.currentVersionId
    ? (
        await db
          .select({ id: fileVersions.id, size: fileVersions.size, key: fileVersions.s3Key, keep: fileVersions.keep })
          .from(fileVersions)
          .where(eq(fileVersions.id, existing.currentVersionId))
      )[0]
    : undefined
  const saved = await db.transaction((tx) =>
    saveUploaded(tx, {
      ownerId: at.ownerId,
      parentId: at.parentId,
      name,
      version: { s3Key: key, size, mime, uploadedBy: c.me.id },
      onConflict: "version",
    })
  )
  if (saved.error || !saved.nodeId) return say(409, saved.error)
  if (before && before.size === 0 && !before.keep) {
    await db.delete(fileVersions).where(eq(fileVersions.id, before.id))
    await deleteUnreferenced([before.key])
  }
  if (isJunk(name)) {
    // Temporary save files keep no history and tell nobody.
    const old = await db
      .delete(fileVersions)
      .where(and(eq(fileVersions.nodeId, saved.nodeId), ne(fileVersions.id, saved.versionId!)))
      .returning({ key: fileVersions.s3Key })
    await deleteUnreferenced(old.map((o) => o.key))
  } else {
    await pruneVersions(saved.nodeId)
    if (at.ownerId !== c.me.id) await notifyEdit(c.me.id, saved.nodeId)
  }
  return say(existing ? 204 : 201, undefined, { ETag: `"${saved.versionId}"` })
}

export async function put(c: Ctx) {
  if (!c.names.length) return say(405)
  // Mac and Windows folder metadata: accepted and thrown away.
  if (isDropped(c.names.at(-1)!)) {
    await c.req.body?.cancel()
    return say(201)
  }
  const { place, parent } = await resolve(c.me.id, c.names)
  if (place && (place.kind !== "node" || place.node.kind === "folder")) return say(405)
  const at = target(c.me, parent)
  if ("status" in at) return say(at.status!)
  const existing = place?.kind === "node" ? place.node : null
  const no =
    (existing && (await locked(c, existing.id))) ||
    (at.parentId && (await locked(c, at.parentId, false, !existing)))
  if (no) return no
  if (!existing && !at.parentId) {
    const no = await locked(c, null)
    if (no) return no
  }
  return store(c, at, existing?.name ?? c.names.at(-1)!, existing, c.req.body)
}

export async function mkcol(c: Ctx) {
  if (!c.names.length) return say(405)
  if (c.req.headers.get("content-length") && c.req.headers.get("content-length") !== "0")
    return say(415)
  const { place, parent } = await resolve(c.me.id, c.names)
  if (place) return say(405)
  const at = target(c.me, parent)
  if ("status" in at) return say(at.status!)
  const no = at.parentId && (await locked(c, at.parentId))
  if (no) return no
  const r = await createFolderAs(c.me.id, at.parentId, c.names.at(-1)!)
  return r.error ? say(statusOf(r.error), r.error) : say(201)
}

export async function remove(c: Ctx) {
  if (c.me.readOnly) return say(403)
  const { place } = await resolve(c.me.id, c.names)
  if (!place) return say(404)
  if (place.kind !== "node") return say(403)
  const no = await locked(c, place.node.id, true)
  if (no) return no
  const r = await trashAs(c.me.id, [place.node.id])
  if (r.error) return say(statusOf(r.error), r.error)
  await dropLock(place.node.id)
  return say(204)
}

// The Destination header's path, as names under /dav/.
function destination(c: Ctx) {
  const raw = c.req.headers.get("destination")
  if (!raw) return null
  let path: string
  try {
    path = new URL(raw, "http://x").pathname
  } catch {
    return null
  }
  if (!(path + "/").startsWith(PREFIX)) return null
  try {
    return path.slice(PREFIX.length).split("/").filter(Boolean).map(decodeURIComponent)
  } catch {
    return null
  }
}

export async function moveOrCopy(c: Ctx, copy: boolean) {
  if (c.me.readOnly) return say(403)
  const names = destination(c)
  if (!names?.length) return say(400)
  const src = await resolve(c.me.id, c.names)
  if (!src.place) return say(404)
  if (src.place.kind !== "node") return say(403)
  const node = src.place.node
  const dst = await resolve(c.me.id, names)
  const at = target(c.me, dst.parent)
  if ("status" in at) return say(at.status!)
  const name = names.at(-1)!
  const sameNode = dst.place?.kind === "node" && dst.place.node.id === node.id
  if (sameNode && copy) return say(403)
  let existed = false
  if (dst.place && !sameNode) {
    if (c.req.headers.get("overwrite")?.toUpperCase() === "F") return say(412)
    if (dst.place.kind !== "node") return say(403)
    // A file landing on a file of the same owner is a save (editors write a
    // temporary file, then move it over the original): it becomes a new
    // version, so the history stays.
    const old = dst.place.node
    if (node.kind === "file" && old.kind === "file" && old.ownerId === node.ownerId) {
      if (!copy && !atLeast(src.place.role, "editor")) return say(403)
      const no =
        (await locked(c, old.id, false, false)) ||
        (!copy && (await locked(c, node.id)))
      if (no) return no
      return saveOver(c.me.id, node, old, !copy)
    }
    const no = await locked(c, dst.place.node.id, true, false)
    if (no) return no
    const r = await trashAs(c.me.id, [dst.place.node.id])
    if (r.error) return say(statusOf(r.error), r.error)
    existed = true
  }
  const no = at.parentId && (await locked(c, at.parentId, false, false))
  if (no) return no

  if (copy) {
    const depth0 = c.req.headers.get("depth") === "0"
    const r = await copyTree(c.me.id, node, at, name, depth0)
    if (r) return r
    return say(existed ? 204 : 201)
  }
  const srcNo = await locked(c, node.id, true)
  if (srcNo) return srcNo
  const r =
    node.parentId === at.parentId && node.ownerId === at.ownerId
      ? name === node.name
        ? {}
        : await renameAs(c.me.id, node.id, name)
      : await moveAs(c.me.id, [node.id], at.parentId, name === node.name ? undefined : name)
  if (r.error) return say(statusOf(r.error), r.error)
  await dropLock(node.id)
  return say(existed ? 204 : 201)
}

// `src`'s current bytes become the newest version of `old`; with `move`, `src`
// goes (its object lives on in the new version).
async function saveOver(me: string, src: Row, old: Row, move: boolean) {
  const [v] = await db
    .select({ key: fileVersions.s3Key, size: fileVersions.size, mime: fileVersions.mime })
    .from(fileVersions)
    .where(eq(fileVersions.id, src.currentVersionId!))
  if (!v) return say(409)
  await db.transaction(async (tx) => {
    const added = await addVersion(tx, old.id, {
      s3Key: v.key,
      size: v.size,
      mime: v.mime,
      uploadedBy: me,
    })
    await tx
      .update(nodes)
      .set({ s3Key: v.key, size: v.size, mime: v.mime, currentVersionId: added.id, updatedAt: new Date() })
      .where(eq(nodes.id, old.id))
  })
  if (move) {
    await deleteNodes(eq(nodes.id, src.id))
    await dropLock(src.id)
  }
  if (isJunk(old.name)) return say(204)
  await pruneVersions(old.id)
  if (old.ownerId !== me) await notifyEdit(me, old.id)
  return say(204)
}

// Copies share the originals' S3 objects (deletes are reference-counted), so
// no bytes move. Bytes still count once against a different owner's quota.
async function copyTree(
  me: string,
  src: Row,
  at: { ownerId: string; parentId: string | null },
  name: string,
  depth0: boolean
) {
  const rows =
    src.kind === "folder" && !depth0
      ? await db.execute<{
          id: string
          parent_id: string | null
          kind: "file" | "folder"
          name: string
          size: string
          mime: string | null
          s3_key: string | null
        }>(sql`
          with recursive t as (
            select id, parent_id, kind, name, size, mime, s3_key, 0 as depth from nodes where id = ${src.id}
            union all
            select n.id, n.parent_id, n.kind, n.name, n.size, n.mime, n.s3_key, t.depth + 1
            from nodes n join t on n.parent_id = t.id where n.trashed_at is null
          )
          select * from t order by depth`)
      : [{ id: src.id, parent_id: src.parentId, kind: src.kind, name: src.name, size: String(src.size), mime: src.mime, s3_key: src.s3Key }]
  if (at.ownerId !== src.ownerId) {
    const total = rows.reduce((s, r) => s + (r.kind === "file" ? Number(r.size) : 0), 0)
    const left = await spaceLeft(at.ownerId)
    if (left !== null && total > left) return say(507, "Storage is full.")
  }
  await db.transaction(async (tx) => {
    const ids = new Map<string, string>()
    for (const [i, r] of rows.entries()) {
      const [n] = await tx
        .insert(nodes)
        .values({
          ownerId: at.ownerId,
          parentId: i === 0 ? at.parentId : ids.get(r.parent_id!)!,
          kind: r.kind,
          name: i === 0 ? name : r.name,
          size: Number(r.size),
          mime: r.mime,
          s3Key: r.s3_key,
        })
        .returning({ id: nodes.id })
      ids.set(r.id, n.id)
      if (r.kind === "file") {
        const v = await addVersion(tx, n.id, {
          s3Key: r.s3_key!,
          size: Number(r.size),
          mime: r.mime,
          uploadedBy: me,
        })
        await tx.update(nodes).set({ currentVersionId: v.id }).where(eq(nodes.id, n.id))
      }
    }
  })
  if (at.ownerId !== me && at.parentId) await notifyEdit(me, at.parentId)
  return null
}

export async function lock(c: Ctx) {
  if (c.me.readOnly) return say(403)
  const body = await c.req.text()
  const { place, parent } = await resolve(c.me.id, c.names)
  const tokens = ifTokens(c.req.headers.get("if"))
  const root = href(PREFIX, c.names, place?.kind === "node" && place.node.kind === "folder")

  // No body: refresh a lock the client holds, here or on a folder above.
  if (!body.trim()) {
    if (place?.kind !== "node") return say(412)
    const ids = [place.node.id, ...(await ancestors(place.node.id))]
    const hit = [...(await getLocks(ids))].find(([, l]) => tokens.has(l.token))
    if (!hit) return say(412)
    const l = { ...hit[1], timeout: timeout(c.req.headers.get("timeout")) }
    await setLock(hit[0], l)
    return xml(200, lockDiscovery(l))
  }
  // Only exclusive write locks; supportedlock says so.
  if (/<(?:[\w.-]+:)?shared\b/.test(body)) return say(412)

  let node: Row
  let created = false
  if (!place && isDropped(c.names.at(-1)!))
    return xml(201, lockDiscovery({ token: `opaquelocktoken:${randomUUID()}`, owner: "", depth: "0", timeout: 60, root }))
  if (!place) {
    // Locking a name that doesn't exist yet makes an empty file to hold it.
    const at = target(c.me, parent)
    if ("status" in at) return say(at.status!)
    const no = at.parentId && (await locked(c, at.parentId, false, false))
    if (no) return no
    const r = await store(c, at, c.names.at(-1)!, null, null)
    if (r.status !== 201) return r
    const again = await resolve(c.me.id, c.names)
    if (again.place?.kind !== "node") return say(409)
    node = again.place.node
    created = true
  } else {
    if (place.kind !== "node") return say(403)
    if (!atLeast(place.role, "editor")) return say(403)
    node = place.node
    // Any lock already here or above conflicts; refreshing one is a LOCK
    // without a body.
    if (await blocking(node.id, new Set())) return say(423)
  }
  const l: Lock = {
    token: `opaquelocktoken:${randomUUID()}`,
    owner: lockOwner(body),
    depth: c.req.headers.get("depth") === "0" ? "0" : "infinity",
    timeout: timeout(c.req.headers.get("timeout")),
    root,
  }
  await setLock(node.id, l)
  return xml(created ? 201 : 200, lockDiscovery(l), { "Lock-Token": `<${l.token}>` })
}

export async function unlock(c: Ctx) {
  const token = c.req.headers.get("lock-token")?.replace(/^<|>$/g, "")
  const { place } = await resolve(c.me.id, c.names)
  if (place?.kind !== "node") return say(404)
  const held = (await getLocks([place.node.id])).get(place.node.id)
  if (!held || held.token !== token) return say(409)
  await dropLock(place.node.id)
  return say(204)
}
