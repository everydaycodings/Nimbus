// A job's S3 destination (Nimbus S3 and manual S3 are stored the same way on the job).
// Relative imports only: runs under plain node in the self-check.
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

import { client, download, removeKeys, upload } from "../backup/dest.ts"
import { decrypt } from "../crypto.ts"
import { manifestKey } from "./refs.ts"

export type JobDest = {
  s3Endpoint: string | null
  s3Region: string | null
  s3Bucket: string | null
  s3AccessKey: string | null
  s3SecretEnc: string | null
  s3PathStyle: boolean
}

export function open(job: JobDest) {
  if (!job.s3Bucket) throw new Error("This job has no storage destination.")
  const secret = job.s3SecretEnc ? decrypt(job.s3SecretEnc) : null
  if (job.s3SecretEnc && secret === null) throw new Error("The saved storage keys can't be read. Enter them again in the job's settings.")
  const s3 = client({
    provider: "other",
    endpoint: job.s3Endpoint,
    region: job.s3Region || "us-east-1",
    bucket: job.s3Bucket,
    folder: "",
    pathStyle: job.s3PathStyle,
    accessKey: job.s3AccessKey,
    secretKey: secret,
    fromEnv: false,
  })
  return { s3, bucket: job.s3Bucket }
}

export const putJson = (d: ReturnType<typeof open>, key: string, body: unknown) =>
  d.s3.send(new PutObjectCommand({ Bucket: d.bucket, Key: key, Body: JSON.stringify(body, null, 2), ContentType: "application/json" }))

// The archive and its manifest.
export const removeArchives = (d: ReturnType<typeof open>, keys: string[]) =>
  removeKeys(d.s3, d.bucket, keys.flatMap((k) => [k, manifestKey(k)]))

export const presign = (d: ReturnType<typeof open>, key: string, filename: string) =>
  getSignedUrl(d.s3, new GetObjectCommand({ Bucket: d.bucket, Key: key, ResponseContentDisposition: `attachment; filename="${filename}"` }), { expiresIn: 15 * 60 })

export { download, upload }
