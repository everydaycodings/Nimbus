// Multipart uploads pass straight through to the backing store's own
// multipart upload under a key `s3-<hex>`; Complete turns the finished object
// into a file version. Parts count against the folder owner's quota while they wait.
import "server-only"

import { randomBytes } from "node:crypto"

import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  HeadObjectCommand,
  ListPartsCommand,
  UploadPartCommand,
  UploadPartCopyCommand,
} from "@aws-sdk/client-s3"
import { and, asc, eq, lt, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { s3Multipart } from "@/lib/db/schema"
import { UUID } from "@/lib/files"
import { spaceLeft } from "@/lib/quota"
import { BUCKET, deleteKeys, s3 } from "@/lib/s3"
import { mimeFor, saveVersion } from "@/lib/store-file"
import { rejectReason, uploadLimits } from "@/lib/uploads"

import { bodyOf, header, nodeStream, readXml, respond, unwrap, userMeta, xml, type C } from "./http.ts"
import { copyFrom, storeError } from "./objects.ts"
import { STALE_MULTIPART_DAYS } from "./rules.ts"
import { childOf, mustWrite, splitKey, type Bucket } from "./resolve.ts"
import { encodeKey, inner, isoDate, tag, text, S3Error } from "./xml.ts"
import { mkdirp } from "@/lib/uploads"

const MAX_PARTS = 10_000

const noUpload = () => new S3Error("NoSuchUpload", "The specified upload does not exist. The upload ID may be invalid, or the upload may have been aborted or completed.", 404)

async function upload(c: C, b: Bucket, uploadId: string | null) {
  if (!uploadId || !UUID.test(uploadId)) throw noUpload()
  const [row] = await db
    .select()
    .from(s3Multipart)
    .where(
      and(eq(s3Multipart.id, uploadId), eq(s3Multipart.bucketId, b.id), eq(s3Multipart.userId, c.who.userId), eq(s3Multipart.key, c.key!))
    )
  if (!row) throw noUpload()
  return row
}

export async function create(c: C, b: Bucket) {
  mustWrite(b)
  splitKey(c.key!)
  const ct = header(c, "content-type")
  const user = userMeta(c)
  const backingKey = `s3-${randomBytes(16).toString("hex")}`
  const r = await s3.send(
    new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: backingKey, ContentType: ct?.split(";")[0] || undefined })
  )
  const [row] = await db.insert(s3Multipart).values({
    userId: c.who.userId,
    bucketId: b.id,
    key: c.key!,
    backingKey,
    backingUploadId: r.UploadId!,
    meta: ct || user ? { ...(ct && { contentType: ct }), ...(user && { user }) } : null,
  }).returning({ id: s3Multipart.id })
  return xml(c, "InitiateMultipartUploadResult", `${tag("Bucket", b.name)}${tag("Key", c.key)}${tag("UploadId", row.id)}`)
}

function partNumber(c: C) {
  const n = Number(c.q.get("partNumber"))
  if (!Number.isInteger(n) || n < 1 || n > MAX_PARTS)
    throw new S3Error("InvalidArgument", `Part number must be an integer between 1 and ${MAX_PARTS}.`, 400)
  return n
}

// What the owner can still take: quota left (which already counts waiting
// parts) and the admin's size limit on the whole file.
async function room(b: Bucket, already: number, adding: number, name: string) {
  const left = await spaceLeft(b.ownerId)
  if (left !== null && adding > left) throw new S3Error("QuotaExceeded", "The storage quota is full.", 403)
  const limits = await uploadLimits()
  const why = rejectReason(name, already + adding, limits)
  if (why) throw new S3Error("EntityTooLarge", why, 400)
}

// ponytail: a part sent twice (a retry) counts twice until the upload ends; recount with ListParts if that bites.
const addBytes = (id: string, n: number) =>
  db.update(s3Multipart).set({ bytes: sql`${s3Multipart.bytes} + ${n}` }).where(eq(s3Multipart.id, id))

export async function uploadPart(c: C, b: Bucket) {
  mustWrite(b)
  const row = await upload(c, b, c.q.get("uploadId"))
  const n = partNumber(c)
  const { stream, declared } = bodyOf(c)
  if (declared === null) throw new S3Error("MissingContentLength", "You must provide the Content-Length HTTP header.", 411)
  await room(b, row.bytes, declared, c.key!.split("/").at(-1)!)
  let r
  try {
    r = await s3.send(
      new UploadPartCommand({
        Bucket: BUCKET,
        Key: row.backingKey,
        UploadId: row.backingUploadId,
        PartNumber: n,
        ContentLength: declared,
        Body: stream ? nodeStream(stream) : new Uint8Array(),
      })
    )
  } catch (e) {
    throw unwrap(e) ?? e
  }
  await addBytes(row.id, declared)
  return respond(c, 200, null, { ETag: r.ETag! })
}

export async function uploadPartCopy(c: C, b: Bucket) {
  mustWrite(b)
  const row = await upload(c, b, c.q.get("uploadId"))
  const n = partNumber(c)
  const { v } = await copyFrom(c, header(c, "x-amz-copy-source")!)
  let range: string | undefined
  let size = v.size
  const m = header(c, "x-amz-copy-source-range")?.match(/^bytes=(\d+)-(\d+)$/)
  if (header(c, "x-amz-copy-source-range")) {
    if (!m || Number(m[1]) > Number(m[2]) || Number(m[2]) >= v.size)
      throw new S3Error("InvalidArgument", "The x-amz-copy-source-range value is not valid for the source.", 400)
    range = m[0]
    size = Number(m[2]) - Number(m[1]) + 1
  }
  await room(b, row.bytes, size, c.key!.split("/").at(-1)!)
  const r = await s3.send(
    new UploadPartCopyCommand({
      Bucket: BUCKET,
      Key: row.backingKey,
      UploadId: row.backingUploadId,
      PartNumber: n,
      CopySource: `${BUCKET}/${encodeURIComponent(v.s3Key)}`,
      CopySourceRange: range,
    })
  )
  await addBytes(row.id, size)
  return xml(c, "CopyPartResult", `${tag("ETag", r.CopyPartResult!.ETag)}${tag("LastModified", isoDate(r.CopyPartResult!.LastModified ?? new Date()))}`)
}

export async function listParts(c: C, b: Bucket) {
  const row = await upload(c, b, c.q.get("uploadId"))
  const max = Math.min(Number(c.q.get("max-parts") ?? 1000) || 1000, 1000)
  const r = await s3.send(
    new ListPartsCommand({
      Bucket: BUCKET,
      Key: row.backingKey,
      UploadId: row.backingUploadId,
      MaxParts: max,
      PartNumberMarker: c.q.get("part-number-marker") ?? undefined,
    })
  )
  const owner = `<Owner>${tag("ID", c.who.userId)}${tag("DisplayName", c.who.userId)}</Owner>`
  return xml(
    c,
    "ListPartsResult",
    `${tag("Bucket", b.name)}${tag("Key", c.key)}${tag("UploadId", row.id)}<Initiator>${tag("ID", c.who.userId)}${tag("DisplayName", c.who.userId)}</Initiator>${owner}${tag("StorageClass", "STANDARD")}${tag("PartNumberMarker", c.q.get("part-number-marker") ?? 0)}${r.NextPartNumberMarker ? tag("NextPartNumberMarker", r.NextPartNumberMarker) : ""}${tag("MaxParts", max)}${tag("IsTruncated", r.IsTruncated ?? false)}${(r.Parts ?? [])
      .map((p) => `<Part>${tag("PartNumber", p.PartNumber)}${tag("LastModified", isoDate(p.LastModified ?? new Date()))}${tag("ETag", p.ETag)}${tag("Size", p.Size)}</Part>`)
      .join("")}`
  )
}

export async function listUploads(c: C, b: Bucket) {
  const prefix = c.q.get("prefix") ?? ""
  const keyMarker = c.q.get("key-marker") ?? ""
  const idMarker = c.q.get("upload-id-marker") ?? ""
  const max = Math.min(Number(c.q.get("max-uploads") ?? 1000) || 1000, 1000)
  const url = c.q.get("encoding-type") === "url"
  const rows = await db
    .select()
    .from(s3Multipart)
    .where(and(eq(s3Multipart.bucketId, b.id), eq(s3Multipart.userId, c.who.userId)))
    .orderBy(asc(s3Multipart.key), asc(s3Multipart.createdAt))
  const after = rows.filter(
    (r) => r.key.startsWith(prefix) && (r.key > keyMarker || (r.key === keyMarker && idMarker !== "" && r.id > idMarker))
  )
  const page = after.slice(0, max)
  const last = page.at(-1)
  const who = `<Initiator>${tag("ID", c.who.userId)}${tag("DisplayName", c.who.userId)}</Initiator><Owner>${tag("ID", c.who.userId)}${tag("DisplayName", c.who.userId)}</Owner>`
  return xml(
    c,
    "ListMultipartUploadsResult",
    `${tag("Bucket", b.name)}${tag("KeyMarker", keyMarker)}${tag("UploadIdMarker", idMarker)}${after.length > max && last ? tag("NextKeyMarker", encodeKey(last.key, url)) + tag("NextUploadIdMarker", last.id) : ""}${tag("Prefix", encodeKey(prefix, url))}${tag("MaxUploads", max)}${url ? tag("EncodingType", "url") : ""}${tag("IsTruncated", after.length > max)}${page
      .map((r) => `<Upload>${tag("Key", encodeKey(r.key, url))}${tag("UploadId", r.id)}${who}${tag("StorageClass", "STANDARD")}${tag("Initiated", isoDate(r.createdAt))}</Upload>`)
      .join("")}`
  )
}

async function abortBacking(row: { backingKey: string; backingUploadId: string }) {
  try {
    await s3.send(new AbortMultipartUploadCommand({ Bucket: BUCKET, Key: row.backingKey, UploadId: row.backingUploadId }))
  } catch (e) {
    // Already gone is the goal.
    if ((e as { name?: string }).name !== "NoSuchUpload") throw e
  }
}

export async function abort(c: C, b: Bucket) {
  mustWrite(b)
  const row = await upload(c, b, c.q.get("uploadId"))
  await abortBacking(row)
  await db.delete(s3Multipart).where(eq(s3Multipart.id, row.id))
  return respond(c, 204)
}

// A bucket going away takes its waiting uploads with it.
export async function abortUploads(bucketId: string) {
  for (const row of await db.select().from(s3Multipart).where(eq(s3Multipart.bucketId, bucketId)))
    await abortBacking(row).catch(() => {})
}

// The worker's daily job: uploads nobody finished in a week.
export async function abortStale() {
  const rows = await db
    .select()
    .from(s3Multipart)
    .where(lt(s3Multipart.createdAt, new Date(Date.now() - STALE_MULTIPART_DAYS * 86_400_000)))
  for (const row of rows) {
    await abortBacking(row)
    await db.delete(s3Multipart).where(eq(s3Multipart.id, row.id))
  }
}

export async function complete(c: C, b: Bucket) {
  mustWrite(b)
  const row = await upload(c, b, c.q.get("uploadId"))
  const body = await readXml(c)
  const parts = inner(body, "Part").map((p) => ({ PartNumber: Number(text(p, "PartNumber")), ETag: text(p, "ETag") }))
  if (!parts.length || parts.some((p, i) => !p.ETag || !Number.isInteger(p.PartNumber) || (i && p.PartNumber <= parts[i - 1].PartNumber)))
    throw new S3Error("InvalidPartOrder", "The list of parts was not in ascending order, or a part is missing its ETag.", 400)
  let done
  try {
    done = await s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: BUCKET,
        Key: row.backingKey,
        UploadId: row.backingUploadId,
        MultipartUpload: { Parts: parts as { PartNumber: number; ETag: string }[] },
      })
    )
  } catch (e) {
    const name = (e as { name?: string }).name
    if (name === "InvalidPart" || name === "EntityTooSmall" || name === "InvalidPartOrder")
      throw new S3Error(name, (e as Error).message, 400)
    if (name === "NoSuchUpload") throw noUpload()
    throw e
  }
  const etag = (done.ETag ?? "").replace(/"/g, "")
  const size = (await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: row.backingKey }))).ContentLength ?? 0
  const drop = async () => {
    await deleteKeys([row.backingKey])
    await db.delete(s3Multipart).where(eq(s3Multipart.id, row.id))
  }
  try {
    // The waiting bytes were already counted; take them out before checking again.
    const left = await spaceLeft(b.ownerId)
    if (left !== null && size > left + row.bytes) throw new S3Error("QuotaExceeded", "The storage quota is full.", 403)
    const why = rejectReason(c.key!.split("/").at(-1)!, size, await uploadLimits())
    if (why) throw new S3Error("EntityTooLarge", why, 400)
    const { parts: names } = splitKey(c.key!)
    const made = await mkdirp(db, b.ownerId, b.nodeId, names.slice(0, -1))
    if ("error" in made) throw new S3Error("InvalidRequest", made.error, 409)
    const name = names.at(-1)!
    const existing = await childOf(b, made.id!, name)
    if (existing?.kind === "folder") throw new S3Error("InvalidRequest", `A folder named “${name}” is in the way of this file.`, 409)
    const meta = row.meta
    const r = await saveVersion({
      me: c.who.userId,
      at: { ownerId: b.ownerId, parentId: made.id! },
      name,
      existing: existing ?? null,
      key: row.backingKey,
      size,
      mime: meta?.contentType?.split(";")[0] || mimeFor(name),
      etag,
      meta: meta ?? undefined,
      quiet: b.quiet,
    })
    if ("error" in r) throw storeError(r.error)
  } catch (e) {
    await drop()
    throw e
  }
  await db.delete(s3Multipart).where(eq(s3Multipart.id, row.id))
  const loc = `${process.env.S3API_DOMAIN ?? ""}/${b.name}/${c.key}`
  return xml(c, "CompleteMultipartUploadResult", `${tag("Location", loc)}${tag("Bucket", b.name)}${tag("Key", c.key)}${tag("ETag", `"${etag}"`)}`)
}
