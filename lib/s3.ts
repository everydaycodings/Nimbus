import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

import { enqueue } from "./redis"
import { contentDisposition } from "./upload-rules"

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

// The browser makes thumbnails; one object holds the thumbnail of every
// version that shares `key`.
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
// ponytail: no sweep for orphans yet; list the bucket against file_versions if they pile up.
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
