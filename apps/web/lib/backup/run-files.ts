// One file backup: an incremental mirror of every file and version Nimbus
// knows about (thumbnails and unfinished uploads can be made again, so they
// stay out). Each run:
//
//   source  the keys in file_versions, against what backup_objects holds
//   copy    new ones streamed across, hashed and (if on) encrypted on the way
//   prune   ones Nimbus purged are marked gone, and deleted after the grace days
//   sample  a random few read back from the backup and hashed again
//
// Relative imports only: plain node runs this.
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { createHash } from "node:crypto"
import type { Readable } from "node:stream"
import { Transform } from "node:stream"
import { pipeline } from "node:stream/promises"

import { pickSample } from "../backup-rules.ts"
import { chain, client, download, fileKey, removeKeys, upload } from "./dest.ts"
import { decryptStream, encryptStream } from "./file-crypto.ts"
import {
  fail,
  finish,
  log,
  readSettings,
  setup,
  sql,
  step,
  StepError,
  type Ctx,
  type Run,
} from "./runs.ts"

const env = process.env
const source = new S3Client({
  endpoint: env.S3_ENDPOINT || undefined,
  region: env.S3_REGION || "us-east-1",
  forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
  credentials: env.S3_ACCESS_KEY
    ? { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY! }
    : undefined,
})

// Passes bytes through, hashing and counting them.
function meter() {
  const hash = createHash("sha256")
  let size = 0
  const t = new Transform({
    transform(chunk: Buffer, _, done) {
      hash.update(chunk)
      size += chunk.length
      done(null, chunk)
    },
  })
  return { t, done: () => ({ sha256: hash.digest("hex"), size }) }
}

// Runs `work` over `items`, `n` at a time.
async function pool<T>(items: T[], n: number, work: (x: T) => Promise<void>) {
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await work(items[i++])
    })
  )
}

const gb = (n: number) => `${(n / 1e9).toFixed(2)} GB`

export async function backupFiles(run: Run) {
  const ctx: Ctx = { run, checks: {}, step: null, t0: Date.now() }
  const s = await readSettings()
  try {
    const encrypt = s.backupFilesEncrypt
    const { dest, key } = setup(s, encrypt)
    const s3 = client(dest)

    await step(ctx, "source")
    // The index describes copies at one destination; a new one gets everything.
    const target = `${dest.endpoint ?? "aws"}|${dest.bucket}|${dest.folder}`
    const moved = s.backupMirrorAt !== null && s.backupMirrorAt !== target
    if (s.backupMirrorAt !== target) {
      await sql`delete from backup_objects`
      await sql`update settings set backup_mirror_at = ${target}`
    }
    const wanted = await sql<{ key: string }[]>`
      select distinct s3_key as key from file_versions
      except select key from backup_objects where gone_at is null`
    // Back in Nimbus (a restore from the backup, say): no longer gone.
    const back = await sql`
      update backup_objects set gone_at = null
      where gone_at is not null and key in (select s3_key from file_versions)
      returning key`
    const backKeys = new Set(back.map((r) => r.key as string))
    const todo = wanted.filter((w) => !backKeys.has(w.key))
    ctx.checks.source = {
      ok: true,
      detail: `${moved ? "Storage changed, so everything is copied to the new place. " : ""}${todo.length} new file(s) to copy.`,
    }

    await step(ctx, "copy")
    let copied = 0
    let bytes = 0
    let missing = 0
    const failed: string[] = []
    await pool(todo, Math.max(1, s.backupFilesConcurrency), async ({ key: k }) => {
      try {
        const r = await source.send(new GetObjectCommand({ Bucket: env.S3_BUCKET!, Key: k }))
        const m = meter()
        const body = chain(r.Body as Readable, m.t, ...(encrypt ? [encryptStream(key!)] : []))
        await upload(s3, dest.bucket, fileKey(dest, k), body, {
          // The hash is known only once the upload has read it all; restore
          // re-hashes against backup_objects, or trusts GCM when encrypted.
          encrypted: encrypt ? "1" : "0",
        })
        const { sha256, size } = m.done()
        await sql`
          insert into backup_objects ${sql({ key: k, size, sha256, encrypted: encrypt })}
          on conflict (key) do update set size = excluded.size, sha256 = excluded.sha256,
            encrypted = excluded.encrypted, copied_at = now(), gone_at = null`
        copied++
        bytes += size
      } catch (e) {
        // Not in Nimbus's bucket (purged since listing, or lost): nothing to copy.
          if ((e as { name?: string }).name === "NoSuchKey") return void missing++
        failed.push(`${k}: ${(e as Error).message}`)
      }
    })
    log(ctx, `copied ${copied} file(s), ${gb(bytes)}, ${failed.length} failed`)
    ctx.checks.copy = failed.length
      ? { ok: false, detail: `${failed.length} file(s) couldn't be copied. First: ${failed[0]}`.slice(0, 1000) }
      : {
          ok: true,
          detail: `${copied} file(s) copied, ${gb(bytes)}.${missing ? ` ${missing} listed in the database aren't in Nimbus's bucket.` : ""}`,
        }

    await step(ctx, "prune")
    const marked = await sql`
      update backup_objects set gone_at = now()
      where gone_at is null and key not in (select s3_key from file_versions)
      returning key`
    const expired = (
      await sql<{ key: string }[]>`
        select key from backup_objects
        where gone_at < now() - make_interval(days => ${s.backupFilesGraceDays})`
    ).map((r) => r.key)
    if (expired.length) {
      await removeKeys(s3, dest.bucket, expired.map((k) => fileKey(dest, k)))
      await sql`delete from backup_objects where key in ${sql(expired)}`
    }
    ctx.checks.prune = {
      ok: true,
      detail: `${marked.length} purged from Nimbus (kept ${s.backupFilesGraceDays} days), ${expired.length} past that deleted.`,
    }

    await step(ctx, "sample")
    const all = await sql<{ key: string; sha256: string; encrypted: boolean }[]>`
      select key, sha256, encrypted from backup_objects where gone_at is null`
    const sample = pickSample(all, s.backupFilesSamplePct)
    const bad: string[] = []
    for (const o of sample) {
      try {
        const m = meter()
        const body = await download(s3, dest.bucket, fileKey(dest, o.key))
        if (o.encrypted && !key) throw new Error("BACKUP_ENCRYPTION_KEY isn't set")
        await pipeline(chain(body, ...(o.encrypted ? [decryptStream(key!)] : [])), m.t, async (src) => {
          for await (const chunk of src) void chunk
        })
        if (m.done().sha256 !== o.sha256) bad.push(`${o.key}: SHA-256 differs`)
      } catch (e) {
        bad.push(`${o.key}: ${(e as Error).message}`)
      }
    }
    ctx.checks.sample = bad.length
      ? { ok: false, detail: `${bad.length} of ${sample.length} read back wrong. First: ${bad[0]}`.slice(0, 1000) }
      : { ok: true, detail: `${sample.length} of ${all.length} file(s) read back and matched.` }

    const [{ total, n }] = await sql<{ total: number; n: number }[]>`
      select coalesce(sum(size), 0)::bigint::float8 as total, count(*)::int as n from backup_objects`
    const stats = { copied, missing, gone: marked.length, removed: expired.length, sampled: sample.length, objects: n, totalBytes: total }
    if (failed.length || bad.length) {
      await sql`update backup_runs set ${sql({ sizeBytes: bytes, stats: sql.json(stats) })} where id = ${run.id}`
      throw new StepError((ctx.checks.copy.ok ? ctx.checks.sample : ctx.checks.copy).detail!)
    }
    await finish(ctx, "ok", { sizeBytes: bytes, stats })
  } catch (e) {
    await fail(ctx, s, e).catch((x) => console.error("backup: after failure", x))
  }
}
