// Where backups go: one S3-compatible bucket the admin picked. BACKUP_S3_*
// env vars win over Admin → Backups, like EMAIL_TRANSPORT does for email.
// Relative imports only: scripts/backup-worker.ts runs this under plain node.
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3"
import { pipeline, type Readable, type Transform } from "node:stream"

import type { Provider } from "../backup-rules.ts"
import { decrypt } from "../crypto.ts"

export type Dest = {
  provider: Provider
  endpoint: string | null
  region: string
  bucket: string
  // Prefix inside the bucket, no slashes at the ends.
  folder: string
  pathStyle: boolean
  accessKey: string | null
  secretKey: string | null
  fromEnv: boolean
}

// The settings columns this reads, as Drizzle names them.
export type DestSettings = {
  backupProvider: Provider | null
  backupEndpoint: string | null
  backupRegion: string | null
  backupBucket: string | null
  backupFolder: string
  backupPathStyle: boolean
  backupAccessKey: string | null
  backupSecretKey: string | null
}

const clean = (folder: string) => folder.replace(/^\/+|\/+$/g, "")

export function envDest(): Dest | null {
  const e = process.env
  if (!e.BACKUP_S3_BUCKET) return null
  return {
    provider: (e.BACKUP_S3_PROVIDER as Provider) || "other",
    endpoint: e.BACKUP_S3_ENDPOINT || null,
    region: e.BACKUP_S3_REGION || "us-east-1",
    bucket: e.BACKUP_S3_BUCKET,
    folder: clean(e.BACKUP_S3_FOLDER ?? "nimbus"),
    pathStyle: e.BACKUP_S3_FORCE_PATH_STYLE === "true",
    accessKey: e.BACKUP_S3_ACCESS_KEY || null,
    secretKey: e.BACKUP_S3_SECRET_KEY || null,
    fromEnv: true,
  }
}

// The destination, or null when none is set up. Throws when the saved keys
// can't be unsealed (BETTER_AUTH_SECRET changed): they must be entered again.
export function resolveDest(s: DestSettings): Dest | null {
  const env = envDest()
  if (env) return env
  if (!s.backupBucket) return null
  const open = (v: string | null) => {
    if (!v) return null
    const plain = decrypt(v)
    if (plain === null)
      throw new Error(
        "The saved backup storage keys can't be read, probably because BETTER_AUTH_SECRET changed. Enter them again under Admin → Backups → Settings."
      )
    return plain
  }
  return {
    provider: s.backupProvider ?? "other",
    endpoint: s.backupEndpoint,
    region: s.backupRegion || "us-east-1",
    bucket: s.backupBucket,
    folder: clean(s.backupFolder),
    pathStyle: s.backupPathStyle,
    accessKey: open(s.backupAccessKey),
    secretKey: open(s.backupSecretKey),
    fromEnv: false,
  }
}

export const client = (d: Dest) =>
  new S3Client({
    endpoint: d.endpoint || undefined,
    region: d.region,
    forcePathStyle: d.pathStyle,
    credentials:
      d.accessKey && d.secretKey
        ? { accessKeyId: d.accessKey, secretAccessKey: d.secretKey }
        : undefined,
  })

export const at = (d: Dest, path: string) =>
  d.folder ? `${d.folder}/${path}` : path

// <folder>/db/2026/10/nimbus-20261019T033000Z-1a2b3c4d.dump.enc
export function dumpKey(d: Dest, runId: string, when: Date) {
  const iso = when.toISOString()
  const stamp = iso.replace(/[-:]/g, "").slice(0, 15) + "Z"
  return at(d, `db/${iso.slice(0, 4)}/${iso.slice(5, 7)}/nimbus-${stamp}-${runId.slice(0, 8)}.dump.enc`)
}

export const fileKey = (d: Dest, key: string) => at(d, `files/${key}`)

// Proves the keys can write here: the bucket answers, then a probe object
// goes in and comes out again.
export async function testDest(d: Dest) {
  const s3 = client(d)
  const probe = at(d, `.nimbus-probe-${Date.now()}`)
  await s3.send(new HeadBucketCommand({ Bucket: d.bucket }))
  await s3.send(new PutObjectCommand({ Bucket: d.bucket, Key: probe, Body: "ok" }))
  await s3.send(new DeleteObjectCommand({ Bucket: d.bucket, Key: probe }))
}

// `src` through `steps`, as one readable. Unlike .pipe(), an error anywhere
// (a dropped download, a failed tag) errors the result instead of stalling it.
export const chain = (src: Readable, ...steps: Transform[]): Readable =>
  steps.length
    ? (pipeline as (...s: unknown[]) => Readable)(src, ...steps, () => {})
    : src

// Under this an object goes up in one PUT; over it, in parts this big.
// ponytail: 16 MB × 10 000 parts caps one object at ~160 GB; raise PART for bigger files.
const PART = 16 * 2 ** 20

// Uploads a stream of unknown length, buffering one part at a time.
export async function upload(
  s3: S3Client,
  bucket: string,
  key: string,
  body: Readable,
  metadata: Record<string, string> = {}
) {
  let buf: Buffer[] = []
  let size = 0
  let uploadId: string | undefined
  const parts: { ETag: string; PartNumber: number }[] = []
  const flush = async () => {
    const chunk = Buffer.concat(buf)
    buf = []
    size = 0
    uploadId ??= (
      await s3.send(
        new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, Metadata: metadata })
      )
    ).UploadId
    const n = parts.length + 1
    const r = await s3.send(
      new UploadPartCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumber: n, Body: chunk })
    )
    parts.push({ ETag: r.ETag!, PartNumber: n })
  }
  try {
    for await (const b of body) {
      buf.push(b)
      size += b.length
      if (size >= PART) await flush()
    }
    if (!uploadId) {
      await s3.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: Buffer.concat(buf), Metadata: metadata })
      )
      return
    }
    if (size) await flush()
    await s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
      })
    )
  } catch (e) {
    if (uploadId)
      await s3
        .send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }))
        .catch(() => {})
    throw e
  }
}

export async function download(s3: S3Client, bucket: string, key: string) {
  const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  return r.Body as Readable
}

// At most 1000 at a time; a missing key isn't an error.
export async function removeKeys(s3: S3Client, bucket: string, keys: string[]) {
  for (let i = 0; i < keys.length; i += 1000) {
    const r = await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true },
      })
    )
    if (r.Errors?.length)
      throw new Error(`The backup bucket kept ${r.Errors.length} objects: ${r.Errors[0].Message}`)
  }
}
