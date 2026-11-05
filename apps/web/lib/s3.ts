import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { Upload } from "@aws-sdk/lib-storage"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

import { enqueue } from "./redis.ts"
import { contentDisposition } from "./upload-rules.ts"

const env = process.env

export const BUCKET = env.S3_BUCKET!

// Missing keys fall back to the SDK's default chain (IAM roles and so on).
export const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT || undefined,
  region: env.S3_REGION || "us-east-1",
  forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
  credentials: env.S3_ACCESS_KEY
    ? { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY! }
    : undefined,
})

export function presignGet(
  key: string,
  filename: string,
  {
    inline = false,
    expiresIn = 3600,
    type,
  }: { inline?: boolean; expiresIn?: number; type?: string } = {}
) {
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ResponseContentDisposition: contentDisposition(filename, inline),
      ResponseContentType: type,
    }),
    { expiresIn }
  )
}

// The object's size, or null if it isn't there.
export async function headSize(key: string) {
  try {
    const r = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }))
    return r.ContentLength ?? 0
  } catch (e) {
    if (
      (e as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode === 404
    )
      return null
    throw e
  }
}

export async function getStream(key: string) {
  const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
  return r.Body!.transformToWebStream()
}

// `range` is an HTTP Range header passed straight to S3.
export async function getRange(key: string, range?: string) {
  const r = await s3.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: key, Range: range })
  )
  return {
    body: r.Body!.transformToWebStream(),
    length: r.ContentLength,
    contentRange: r.ContentRange,
  }
}

// Multipart, so a body of any size streams through in 8 MB parts.
export async function putStream(
  key: string,
  body: ReadableStream<Uint8Array>,
  type: string
) {
  await new Upload({
    client: s3,
    params: { Bucket: BUCKET, Key: key, Body: body, ContentType: type },
    partSize: 8 * 1024 * 1024,
  }).done()
}

// The browser or the worker makes thumbnails; one object holds the thumbnail
// of every version that shares `key`.
export const thumbKey = (key: string) => `thumbs/${key}.webp`

export async function deleteObject(key: string) {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
}

export async function putObject(key: string, body: Uint8Array, type: string) {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: type,
    })
  )
}

export async function getText(key: string) {
  const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
  return r.Body!.transformToString()
}

// Deletes the objects, the `.info` files tusd keeps beside them and their
// thumbnails, in the worker (/api/jobs), retried until S3 takes it. The rows are
// already gone, so with Redis away it's tried once from here.
// Anything that slips through is caught by the weekly orphan sweep (lib/orphan-sweep.ts).
export async function deleteKeys(keys: string[]) {
  const all = [...new Set(keys)].flatMap((k) => [k, `${k}.info`, thumbKey(k)])
  for (let i = 0; i < all.length; i += 1000) {
    const batch = all.slice(i, i + 1000)
    await enqueue("delete-keys", { keys: batch }).catch(() =>
      removeObjects(batch).catch((e) => console.error("S3 delete failed", e))
    )
  }
}

// At most 1000 keys. Throws on any failure; deleting a missing key isn't one.
export async function removeObjects(keys: string[]) {
  const r = await s3.send(
    new DeleteObjectsCommand({
      Bucket: BUCKET,
      Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
    })
  )
  if (r.Errors?.length)
    throw new Error(
      `S3 kept ${r.Errors.length} objects: ${r.Errors[0].Code} ${r.Errors[0].Message}`
    )
}

// The objects directly under `prefix` ("" for the bucket's root), not in
// deeper "folders", a page of 1000 at a time.
export async function listKeys(prefix = "") {
  const out: { key: string; size: number; lastModified: number }[] = []
  let token: string | undefined
  do {
    const r = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix || undefined,
        Delimiter: "/",
        ContinuationToken: token,
      })
    )
    for (const o of r.Contents ?? [])
      out.push({
        key: o.Key!,
        size: o.Size ?? 0,
        lastModified: o.LastModified?.getTime() ?? 0,
      })
    token = r.IsTruncated ? r.NextContinuationToken : undefined
  } while (token)
  return out
}
