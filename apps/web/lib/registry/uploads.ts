// Chunked, resumable blob uploads. Bytes go to an S3 multipart upload at registry/b/<uuid>;
// the sha256 state (hash-wasm save/load) and part list live in registry_uploads, so any
// request can continue where the last one stopped. S3 wants parts of 5 MB or more except
// the last, so the trailing bytes of a chunk wait in a small temp object (registry/t/…)
// and are put in front of the next chunk. Small blobs never start a multipart upload.
import "server-only"

import { randomUUID } from "node:crypto"

import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  PutObjectCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3"
import { and, eq, lt } from "drizzle-orm"
import { createSHA256 } from "hash-wasm"

import { db } from "@/lib/db"
import { registryBlobs, registryRepoBlobs, registryUploads } from "@/lib/db/schema"
import type { registryNamespaces } from "@/lib/db/schema"
import { UUID } from "@/lib/files"
import { BUCKET, deleteObject, s3 } from "@/lib/s3"

import { claimSpace } from "./blobs.ts"
import { errors } from "./http.ts"

const MIN = 5 * 1024 * 1024
const PART = 8 * 1024 * 1024
export const STALE_UPLOAD_DAYS = 7

type Row = typeof registryUploads.$inferSelect
type Ns = typeof registryNamespaces.$inferSelect

export async function startUpload(repoId: string, userId: string | null) {
  const [row] = await db
    .insert(registryUploads)
    .values({ repoId, s3Key: `registry/b/${randomUUID()}`, s3UploadId: "", createdBy: userId })
    .returning()
  return row
}

export async function getUpload(repoId: string, id: string) {
  if (!UUID.test(id)) throw errors.uploadUnknown()
  const [row] = await db
    .select()
    .from(registryUploads)
    .where(and(eq(registryUploads.id, id), eq(registryUploads.repoId, repoId)))
  if (!row) throw errors.uploadUnknown()
  return row
}

async function readTail(key: string) {
  const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
  return Buffer.from(await r.Body!.transformToByteArray())
}

// Feeds a request body into the upload. Not final: parts and the tail are written and the
// row is updated. Final: the unwritten rest is returned for the caller to finish with.
async function ingest(row: Row, body: ReadableStream<Uint8Array> | null, final: boolean) {
  const h = await createSHA256()
  if (row.hashState) h.load(Buffer.from(row.hashState, "base64"))
  else h.init()
  let uploadId = row.s3UploadId
  const parts = [...row.parts]
  let chunks: Buffer[] = row.tailKey && row.tailSize ? [await readTail(row.tailKey)] : []
  let size = row.tailKey && row.tailSize ? row.tailSize : 0
  let received = 0

  const flush = async () => {
    if (!uploadId) {
      const r = await s3.send(new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: row.s3Key, ContentType: "application/octet-stream" }))
      uploadId = r.UploadId!
      // Saved at once so a retry continues this multipart upload instead of leaking it.
      await db.update(registryUploads).set({ s3UploadId: uploadId }).where(eq(registryUploads.id, row.id))
    }
    const n = parts.length + 1
    const r = await s3.send(
      new UploadPartCommand({ Bucket: BUCKET, Key: row.s3Key, UploadId: uploadId, PartNumber: n, Body: Buffer.concat(chunks) })
    )
    parts.push({ n, etag: r.ETag! })
    chunks = []
    size = 0
  }

  if (body)
    for await (const c of body as unknown as AsyncIterable<Uint8Array>) {
      const b = Buffer.from(c)
      h.update(b)
      received += b.length
      chunks.push(b)
      size += b.length
      if (size >= PART) await flush()
    }
  if (final) return { h, uploadId, parts, last: Buffer.concat(chunks), total: row.offset + received }

  if (size >= MIN) await flush()
  let tailKey: string | null = null
  if (size > 0) {
    tailKey = `registry/t/${row.id}.${row.offset + received}`
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: tailKey, Body: Buffer.concat(chunks) }))
  }
  const moved = await db
    .update(registryUploads)
    .set({
      parts,
      offset: row.offset + received,
      hashState: Buffer.from(h.save()).toString("base64"),
      tailKey,
      tailSize: size,
      s3UploadId: uploadId,
      updatedAt: new Date(),
    })
    .where(and(eq(registryUploads.id, row.id), eq(registryUploads.offset, row.offset)))
    .returning()
  if (!moved.length) {
    if (tailKey) await deleteObject(tailKey).catch(() => {})
    throw errors.uploadInvalid("The upload changed while this chunk was sent.", 416)
  }
  if (row.tailKey) await deleteObject(row.tailKey).catch(() => {})
  return { row: moved[0] }
}

export async function patch(row: Row, body: ReadableStream<Uint8Array> | null) {
  return (await ingest(row, body, false) as { row: Row }).row
}

// Throws the upload away: the multipart upload, the tail and the row.
export async function discard(row: Row) {
  if (row.s3UploadId)
    await s3.send(new AbortMultipartUploadCommand({ Bucket: BUCKET, Key: row.s3Key, UploadId: row.s3UploadId })).catch(() => {})
  if (row.tailKey) await deleteObject(row.tailKey).catch(() => {})
  await db.delete(registryUploads).where(eq(registryUploads.id, row.id))
}

// The closing request (PUT ?digest=): any last bytes, then verify, dedup, store and link.
export async function finish(row: Row, ns: Ns, digest: string, body: ReadableStream<Uint8Array> | null) {
  const f = (await ingest(row, body, true)) as Exclude<Awaited<ReturnType<typeof ingest>>, { row: Row }>
  const sum = `sha256:${f.h.digest("hex")}`
  if (sum !== digest) {
    await discard({ ...row, s3UploadId: f.uploadId })
    throw errors.digestInvalid()
  }
  const [have] = await db.select().from(registryBlobs).where(eq(registryBlobs.digest, digest))
  try {
    await claimSpace(ns, digest, f.total)
  } catch (e) {
    await discard({ ...row, s3UploadId: f.uploadId })
    throw e
  }
  if (have) {
    // Already stored: keep the old object, drop this one.
    await discard({ ...row, s3UploadId: f.uploadId })
  } else {
    if (!f.uploadId) await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: row.s3Key, Body: f.last, ContentType: "application/octet-stream" }))
    else {
      const parts = [...f.parts]
      if (f.last.length) {
        const n = parts.length + 1
        const r = await s3.send(
          new UploadPartCommand({ Bucket: BUCKET, Key: row.s3Key, UploadId: f.uploadId, PartNumber: n, Body: f.last })
        )
        parts.push({ n, etag: r.ETag! })
      }
      await s3.send(
        new CompleteMultipartUploadCommand({
          Bucket: BUCKET,
          Key: row.s3Key,
          UploadId: f.uploadId,
          MultipartUpload: { Parts: parts.map((p) => ({ PartNumber: p.n, ETag: p.etag })) },
        })
      )
    }
    const made = await db
      .insert(registryBlobs)
      .values({ digest, key: row.s3Key, size: f.total })
      .onConflictDoNothing()
      .returning({ d: registryBlobs.digest })
    // Another upload of the same bytes won the race.
    if (!made.length) await deleteObject(row.s3Key).catch(() => {})
    if (row.tailKey) await deleteObject(row.tailKey).catch(() => {})
    await db.delete(registryUploads).where(eq(registryUploads.id, row.id))
  }
  await db.insert(registryRepoBlobs).values({ repoId: row.repoId, digest }).onConflictDoNothing()
}

// The worker's daily job: uploads nobody touched in a week, tail objects included.
export async function abortStale() {
  const rows = await db
    .select()
    .from(registryUploads)
    .where(lt(registryUploads.updatedAt, new Date(Date.now() - STALE_UPLOAD_DAYS * 86_400_000)))
  for (const row of rows) await discard(row)
}
