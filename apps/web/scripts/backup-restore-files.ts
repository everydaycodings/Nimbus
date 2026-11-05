// Copies the file mirror from the backup bucket back into Nimbus's bucket
// (S3_BUCKET), decrypting as it goes. Files already there are skipped, so it
// is safe to run again after an interruption.
//
//   npm run backup:restore-files
//
// The backup bucket comes from BACKUP_S3_* env, or from Admin → Backups when
// the database is up. Needs BACKUP_ENCRYPTION_KEY for encrypted copies.
import {
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3"
import { at, chain, client, download, envDest, resolveDest, upload, type Dest } from "../lib/backup/dest.ts"
import { backupKey, decryptStream } from "../lib/backup/file-crypto.ts"

const env = process.env
const nimbus = new S3Client({
  endpoint: env.S3_ENDPOINT || undefined,
  region: env.S3_REGION || "us-east-1",
  forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
  credentials: env.S3_ACCESS_KEY
    ? { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY! }
    : undefined,
})

async function destination(): Promise<Dest> {
  const fromEnv = envDest()
  if (fromEnv) return fromEnv
  const { readSettings, sql } = await import("../lib/backup/runs.ts")
  const d = resolveDest(await readSettings())
  await sql.end()
  if (!d) throw new Error("No backup bucket: set BACKUP_S3_* or configure Admin → Backups.")
  return d
}

const d = await destination()
const s3 = client(d)
const key = backupKey()
const prefix = at(d, "files/")

const exists = (k: string) =>
  nimbus
    .send(new HeadObjectCommand({ Bucket: env.S3_BUCKET!, Key: k }))
    .then(() => true)
    .catch((e) => (e.name === "NotFound" ? false : Promise.reject(e)))

let restored = 0
let skipped = 0
const failed: string[] = []
let token: string | undefined
do {
  const page = await s3.send(
    new ListObjectsV2Command({ Bucket: d.bucket, Prefix: prefix, ContinuationToken: token })
  )
  token = page.NextContinuationToken
  // ponytail: one file at a time; run several copies of this with different prefixes if it's too slow.
  for (const o of page.Contents ?? []) {
    const k = o.Key!.slice(prefix.length)
    try {
      if (await exists(k)) {
        skipped++
        continue
      }
      const body = await download(s3, d.bucket, o.Key!)
      const head = await s3.send(new HeadObjectCommand({ Bucket: d.bucket, Key: o.Key! }))
      const sealed = head.Metadata?.encrypted !== "0"
      if (sealed && !key) throw new Error("encrypted, and BACKUP_ENCRYPTION_KEY isn't set")
      // GCM checks an encrypted copy as it decrypts; a failure throws before the upload completes.
      await upload(nimbus, env.S3_BUCKET!, k, chain(body, ...(sealed ? [decryptStream(key!)] : [])))
      restored++
    } catch (e) {
      failed.push(`${k}: ${(e as Error).message}`)
    }
  }
  console.log(`${restored} restored, ${skipped} already there, ${failed.length} failed…`)
} while (token)

for (const f of failed) console.error(f)
process.exit(failed.length ? 1 : 0)
