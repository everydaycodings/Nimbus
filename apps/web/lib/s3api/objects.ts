// Object operations: GET, HEAD, PUT, DELETE, DeleteObjects, CopyObject.
import "server-only"

import { and, eq, isNull, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { nodes } from "@/lib/db/schema"
import { mimeOf } from "@/lib/file-rules"
import { getRange } from "@/lib/s3"
import { mimeFor, saveVersion, storeFile, type StoreError } from "@/lib/store-file"
import { trashAs } from "@/lib/tree-ops"
import { trashNodes } from "@/lib/tree"
import { spaceLeft } from "@/lib/quota"
import { mkdirp } from "@/lib/uploads"

import { etagOf, enqueueVersionEtag } from "./etags.ts"
import { bodyOf, header, respond, userMeta, xml, unwrap, type C } from "./http.ts"
import { bucketFor, childOf, findObject, mustWrite, splitKey, versionOf, walk, type Bucket } from "./resolve.ts"
import { inner, isoDate, tag, text, S3Error } from "./xml.ts"

const EMPTY_MD5 = "d41d8cd98f00b204e9800998ecf8427e"

// Not built (yet): answered with 501 so a client knows to stop asking.
export const UNSUPPORTED = new Set([
  "acl", "cors", "policy", "tagging", "lifecycle", "encryption", "website", "logging", "notification",
  "replication", "object-lock", "retention", "legal-hold", "accelerate", "requestPayment", "ownershipControls",
  "publicAccessBlock", "analytics", "metrics", "inventory", "intelligent-tiering", "torrent", "attributes",
  "restore", "select", "policyStatus", "versionId", "versions",
])

export function storeError(e: StoreError): S3Error {
  switch (e.code) {
    case "tooBig":
      return new S3Error("EntityTooLarge", e.message ?? "Your proposed upload exceeds the maximum allowed size.", 400)
    case "full":
      return new S3Error("QuotaExceeded", "The storage quota is full.", 403)
    case "conflict":
      return new S3Error("InvalidRequest", e.message ?? "That name clashes with something already there.", 409)
    case "check":
      return new S3Error("BadDigest", e.message ?? "The content didn't match.", 400)
    default:
      return new S3Error("AccessDenied", e.message ?? "Not allowed.")
  }
}

const httpDate = (d: Date) => d.toUTCString()

// The Content-Type a client sent, unless it's the generic one.
function mimeFrom(ct: string | null, name: string) {
  const t = ct?.split(";")[0].trim().toLowerCase()
  return t && t !== "application/octet-stream" && t !== "binary/octet-stream" ? t : mimeFor(name)
}

// Folders S3 paths created, removed again when they end up empty.
async function pruneEmpty(b: Bucket, folderId: string | null) {
  let id = folderId
  while (id && id !== b.nodeId) {
    const [row] = await db
      .select({ parentId: nodes.parentId, kids: sql<number>`(select count(*) from nodes k where k.parent_id = ${id} and k.trashed_at is null)` })
      .from(nodes)
      .where(eq(nodes.id, id))
    if (!row || Number(row.kids) > 0) return
    await trashNodes(db, b.ownerId, [id])
    id = row.parentId
  }
}

type Meta = { contentType?: string; user?: Record<string, string> }

export async function head(c: C, b: Bucket, isHead: boolean) {
  const { node } = await findObject(b, c.key!)
  if (!node) throw new S3Error("NoSuchKey", "The specified key does not exist.", 404)
  if (node.kind === "folder")
    return respond(c, 200, null, { ETag: `"${EMPTY_MD5}"`, "Content-Length": "0", "Content-Type": "application/x-directory", "Last-Modified": httpDate(node.updatedAt), "Accept-Ranges": "bytes" })
  const v = await versionOf(node.currentVersionId)
  if (!v) throw new S3Error("NoSuchKey", "The specified key does not exist.", 404)
  if (!v.etag) await enqueueVersionEtag(v.id)
  const etag = `"${etagOf(v)}"`
  const meta = v.meta as Meta | null
  const headers: Record<string, string> = {
    ETag: etag,
    "Last-Modified": httpDate(v.createdAt),
    "Accept-Ranges": "bytes",
    "Content-Type": meta?.contentType ?? (mimeOf(v.mime, node.name) || mimeFor(node.name)),
  }
  for (const [k, val] of Object.entries(meta?.user ?? {})) headers[`x-amz-meta-${k}`] = val

  // Conditional requests.
  const ifMatch = header(c, "if-match")
  const none = header(c, "if-none-match")
  const since = header(c, "if-modified-since")
  const unmod = header(c, "if-unmodified-since")
  const same = (list: string) => list.split(",").some((t) => t.trim().replace(/^W\//, "") === etag || t.trim() === "*")
  if (ifMatch && !same(ifMatch)) throw new S3Error("PreconditionFailed", "At least one of the pre-conditions you specified did not hold.", 412)
  if (unmod && !ifMatch && v.createdAt.getTime() > Date.parse(unmod))
    throw new S3Error("PreconditionFailed", "At least one of the pre-conditions you specified did not hold.", 412)
  if (none && same(none)) return respond(c, 304, null, headers)
  if (since && !none && Math.floor(v.createdAt.getTime() / 1000) <= Math.floor(Date.parse(since) / 1000))
    return respond(c, 304, null, headers)

  // One range only; anything else gets the whole object.
  const m = header(c, "range")?.match(/^bytes=(\d*)-(\d*)$/)
  let start = 0
  let end = v.size - 1
  let ranged = false
  if (m && (m[1] || m[2])) {
    if (m[1]) {
      start = Number(m[1])
      end = m[2] ? Math.min(Number(m[2]), v.size - 1) : v.size - 1
    } else {
      start = Math.max(0, v.size - Number(m[2]))
    }
    if (start >= v.size || start > end)
      throw new S3Error("InvalidRange", "The requested range is not satisfiable", 416)
    ranged = true
  }
  const length = v.size ? end - start + 1 : 0
  headers["Content-Length"] = String(length)
  if (ranged) headers["Content-Range"] = `bytes ${start}-${end}/${v.size}`
  if (isHead || !v.size) return respond(c, ranged ? 206 : 200, null, headers)
  const r = await getRange(v.s3Key, ranged ? `bytes=${start}-${end}` : undefined)
  return respond(c, ranged ? 206 : 200, r.body, headers)
}

// Where a PUT or copy puts a key's file: the folder (made if it's missing)
// and the file already there, if any.
async function place(c: C, b: Bucket, key: string) {
  const { parts } = splitKey(key)
  const dirs = parts.slice(0, -1)
  const made = await mkdirp(db, b.ownerId, b.nodeId, dirs)
  if ("error" in made) throw new S3Error("InvalidRequest", made.error, 409)
  const parentId = made.id!
  const name = parts.at(-1)!
  const clash = await childOf(b, parentId, name)
  if (clash?.kind === "folder") {
    await pruneEmpty(b, parentId)
    throw new S3Error("InvalidRequest", `A folder named “${name}” is in the way of this file.`, 409)
  }
  return { parentId, name, existing: clash ?? null }
}

export async function put(c: C, b: Bucket) {
  mustWrite(b)
  const key = c.key!
  const { dir, parts } = splitKey(key)
  if (dir) {
    const { stream, declared } = bodyOf(c)
    await stream?.cancel()
    if (declared) throw new S3Error("InvalidRequest", "A key ending in / makes a folder and takes no body.", 400)
    const made = await mkdirp(db, b.ownerId, b.nodeId, parts)
    if ("error" in made) throw new S3Error("InvalidRequest", made.error, 409)
    return respond(c, 200, null, { ETag: `"${EMPTY_MD5}"` })
  }
  const { parentId, name, existing } = await place(c, b, key)
  const { stream, declared } = bodyOf(c)
  if (declared === null && !header(c, "transfer-encoding"))
    throw new S3Error("MissingContentLength", "You must provide the Content-Length HTTP header.", 411)
  const ct = header(c, "content-type")
  const user = userMeta(c)
  const md5 = header(c, "content-md5")
  let r
  try {
    r = await storeFile({
      me: c.who.userId,
      at: { ownerId: b.ownerId, parentId },
      name,
      existing,
      body: stream,
      declared,
      mime: mimeFrom(ct, name),
      prefix: "s3",
      meta: ct || user ? { ...(ct && { contentType: ct }), ...(user && { user }) } : undefined,
      quiet: b.quiet,
      check: md5 ? (got) => (Buffer.from(md5, "base64").toString("hex") === got.md5 ? null : "The Content-MD5 you specified did not match what we received.") : undefined,
    })
  } catch (e) {
    if (!existing) await pruneEmpty(b, parentId)
    throw unwrap(e) ?? e
  }
  if ("error" in r) {
    if (!existing) await pruneEmpty(b, parentId)
    throw storeError(r.error)
  }
  return respond(c, 200, null, { ETag: `"${r.etag}"` })
}

// Moves a file to the trash, then clears the folders S3 paths made that are now empty.
async function removeOne(c: C, b: Bucket, key: string) {
  const { dir, parts } = splitKey(key)
  const found = await findObject(b, key)
  if (!found.node) return
  if (dir) {
    const [kid] = await db
      .select({ id: nodes.id })
      .from(nodes)
      .where(and(eq(nodes.parentId, found.node.id), isNull(nodes.trashedAt)))
      .limit(1)
    if (kid) return
  }
  const r = await trashAs(c.who.userId, [found.node.id])
  if (r.error) throw new S3Error("AccessDenied", r.error)
  if (parts.length > 1 || dir) await pruneEmpty(b, found.folder)
}

export async function remove(c: C, b: Bucket) {
  mustWrite(b)
  await removeOne(c, b, c.key!)
  return respond(c, 204)
}

export async function removeMany(c: C, b: Bucket, body: string) {
  mustWrite(b)
  const quiet = text(body, "Quiet") === "true"
  const keys = inner(body, "Object").map((o) => text(o, "Key")).filter((k): k is string => k !== undefined)
  if (!keys.length || keys.length > 1000) throw new S3Error("MalformedXML", "Send between 1 and 1000 keys.", 400)
  let out = ""
  for (const key of keys) {
    try {
      await removeOne(c, b, key)
      if (!quiet) out += `<Deleted>${tag("Key", key)}</Deleted>`
    } catch (e) {
      const s = e instanceof S3Error ? e : new S3Error("InternalError", "We encountered an internal error.", 500)
      out += `<Error>${tag("Key", key)}${tag("Code", s.code)}${tag("Message", s.message)}</Error>`
    }
  }
  return xml(c, "DeleteResult", out)
}

// "/bucket/key/with%20escapes" → its parts.
function copySource(raw: string) {
  const [path, query] = raw.split("?")
  let s: string
  try {
    s = decodeURIComponent(path)
  } catch {
    throw new S3Error("InvalidArgument", "Invalid x-amz-copy-source.", 400)
  }
  s = s.replace(/^\//, "")
  const i = s.indexOf("/")
  if (i < 1 || i === s.length - 1) throw new S3Error("InvalidArgument", "Invalid x-amz-copy-source: use bucket/key.", 400)
  if (query && /versionId=/.test(query)) throw new S3Error("NotImplemented", "Copying a specific version isn't supported.", 501)
  return { bucket: s.slice(0, i), key: s.slice(i + 1) }
}

// The file a copy reads: any bucket this key reaches.
export async function copyFrom(c: C, raw: string) {
  const src = copySource(raw)
  const sb = await bucketFor(c.who, src.bucket)
  const { node } = await findObject(sb, src.key)
  if (!node || node.kind !== "file") throw new S3Error("NoSuchKey", "The specified key does not exist.", 404)
  const v = await versionOf(node.currentVersionId)
  if (!v) throw new S3Error("NoSuchKey", "The specified key does not exist.", 404)
  return { node, v, bucket: sb }
}

export async function copy(c: C, b: Bucket) {
  mustWrite(b)
  const { node: sn, v, bucket: sb } = await copyFrom(c, header(c, "x-amz-copy-source")!)
  const replace = header(c, "x-amz-metadata-directive")?.toUpperCase() === "REPLACE"
  const { parentId, name, existing } = await place(c, b, c.key!)
  if (existing?.id === sn.id && !replace) {
    throw new S3Error("InvalidRequest", "This copy request is illegal because it is trying to copy an object to itself without changing the object's metadata.", 400)
  }
  // Copies share the original's S3 object, so no bytes move; they still count
  // once against a different owner's quota.
  if (b.ownerId !== sb.ownerId) {
    const left = await spaceLeft(b.ownerId)
    if (left !== null && v.size > left) throw new S3Error("QuotaExceeded", "The storage quota is full.", 403)
  }
  const ct = header(c, "content-type")
  const user = userMeta(c)
  const meta = replace
    ? ct || user ? { ...(ct && { contentType: ct }), ...(user && { user }) } : undefined
    : ((v.meta as Meta | null) ?? undefined)
  const r = await saveVersion({
    me: c.who.userId,
    at: { ownerId: b.ownerId, parentId },
    name,
    existing,
    key: v.s3Key,
    size: v.size,
    mime: replace ? mimeFrom(ct, name) : (v.mime ?? mimeFor(name)),
    etag: v.etag,
    meta,
    quiet: b.quiet,
  })
  if ("error" in r) {
    if (!existing) await pruneEmpty(b, parentId)
    throw storeError(r.error)
  }
  const [saved] = await db.execute<{ at: Date }>(sql`select created_at as at from file_versions where id = ${r.versionId}`)
  return xml(c, "CopyObjectResult", `${tag("ETag", `"${v.etag ?? r.versionId.replace(/-/g, "")}"`)}${tag("LastModified", isoDate(new Date(saved.at)))}`)
}

export { walk }
