// One database backup, end to end (ported from dashv2):
//
//   snapshot  repeatable-read transaction on the live database, snapshot
//             exported, every table fingerprinted inside it
//   dump      pg_dump at that same snapshot, encrypted as it streams to disk
//   restore   decrypt, restore into a throwaway Postgres
//   compare   the copy's fingerprint must equal the live snapshot's
//   upload    only now, so a backup that doesn't restore never leaves
//   file      download it again: the stored bytes must be the verified ones
//   retention delete the dumps the retention rule no longer keeps
//
// Nothing throws to the caller: the run row is the record.
// Relative imports only: plain node runs this.
import { createHash } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Transform } from "node:stream"
import { pipeline } from "node:stream/promises"

import {
  judgeRestore,
  restoreErrors,
  scrub,
  selectToDelete,
  shrank,
  type Fingerprint,
} from "../backup-rules.ts"
import { client, download, dumpKey, removeKeys, upload, type Dest } from "./dest.ts"
import { decryptFile, encryptStream } from "./file-crypto.ts"
import {
  openSnapshot,
  pgDump,
  readFingerprint,
  startScratch,
  type Prerequisites,
} from "./pg.ts"
import {
  fail,
  finish,
  getRun,
  log,
  readSettings,
  setup,
  sql,
  step,
  StepError,
  updateRun,
  type Ctx,
  type Run,
} from "./runs.ts"

const dbUrl = () => process.env.DATABASE_URL!
const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`

const hashing = (hash: ReturnType<typeof createHash>) =>
  new Transform({
    transform(chunk: Buffer, _, done) {
      hash.update(chunk)
      done(null, chunk)
    },
  })

async function sha256Of(file: string) {
  const hash = createHash("sha256")
  await pipeline(createReadStream(file), hash)
  return hash.digest("hex")
}

// Downloads `key`; it must be byte for byte what was verified.
async function fetchStored(ctx: Ctx, d: Dest, key: string, sha: string, dir: string) {
  await step(ctx, "file")
  const file = join(dir, "downloaded.enc")
  await pipeline(await download(client(d), d.bucket, key), createWriteStream(file))
  if ((await sha256Of(file)) !== sha) {
    ctx.checks.file = {
      ok: false,
      detail: "The file in storage doesn't match the one that was verified (SHA-256 differs).",
    }
    throw new StepError(ctx.checks.file.detail!)
  }
  ctx.checks.file = { ok: true, detail: "Downloaded again: byte for byte the file that was verified." }
  return file
}

// Restores `sealed` into a scratch server and judges it against `live`.
async function verify(
  ctx: Ctx,
  o: { sealed: string; key: Buffer; major: number; prerequisites: Prerequisites; live: Fingerprint; dir: string }
) {
  await step(ctx, "restore")
  const plain = join(o.dir, "backup.dump")
  await decryptFile(o.sealed, plain, o.key)
  const scratch = await startScratch(o.major, ctx.run.id, o.prerequisites)
  try {
    const entries = await scratch.list(plain)
    const { harmless, fatal } = restoreErrors(await scratch.restore(plain))
    await step(ctx, "compare", { stats: { entries, harmless: harmless.length } })
    const { diffs, checks } = judgeRestore(o.live, await readFingerprint(scratch.url), fatal.map(scrub))
    Object.assign(ctx.checks, checks)
    await updateRun(ctx.run.id, { diffs, checks: ctx.checks })
    log(ctx, `compared: ${entries} entries, ${diffs.length} difference(s), ${fatal.length} restore error(s)`)
    const bad = [ctx.checks.restore, ctx.checks.schema].find((c) => c && !c.ok)
    if (bad) throw new StepError(bad.detail!)
  } finally {
    await scratch.stop()
    await rm(plain, { force: true })
  }
}

// `current` was just verified: it counts as the newest good dump.
async function retention(ctx: Ctx, s: Awaited<ReturnType<typeof readSettings>>, d: Dest) {
  await step(ctx, "retention")
  const files = await sql<{ id: string; at: Date; status: Run["status"]; pinned: boolean; s3Key: string }[]>`
    select id, started_at as at, status, pinned, s3_key from backup_runs
    where kind = 'db' and s3_key is not null and deleted_at is null
      and trigger <> 'reverify' and id <> ${ctx.run.id}`
  const doomed = new Set(
    selectToDelete(
      [...files, { id: ctx.run.id, at: ctx.run.startedAt, status: "ok", pinned: ctx.run.pinned }],
      s.backupRetention,
      new Date()
    )
  )
  const gone = files.filter((f) => doomed.has(f.id))
  log(ctx, `retention deletes ${gone.length} dump(s)`)
  if (!gone.length) return
  await removeKeys(client(d), d.bucket, gone.map((f) => f.s3Key))
  await sql`update backup_runs set deleted_at = now() where id in ${sql(gone.map((f) => f.id))}`
}

export async function backupDb(run: Run) {
  const ctx: Ctx = { run, checks: {}, step: null, t0: Date.now() }
  const s = await readSettings()
  const dir = await mkdtemp(join(tmpdir(), "nimbus-backup-"))
  try {
    const { dest, key } = setup(s, true)

    await step(ctx, "snapshot")
    const snap = await openSnapshot(dbUrl())
    const sealed = join(dir, "backup.enc")
    const hash = createHash("sha256")
    let live: Fingerprint
    try {
      live = await snap.fingerprint()
      ctx.checks.database = {
        ok: true,
        detail: `Postgres ${snap.major}, ${mb(snap.sizeBytes)}, ${Object.keys(live.tables).length} tables fingerprinted.`,
      }
      await step(ctx, "dump", { dbSizeBytes: snap.sizeBytes, fingerprint: live })
      const encrypt = encryptStream(key!)
      await Promise.all([
        pgDump(dbUrl(), snap.major, snap.snapshot, snap.prerequisites.extensions, encrypt),
        pipeline(encrypt, hashing(hash), createWriteStream(sealed)),
      ])
    } finally {
      await snap.close()
    }
    const sha256 = hash.digest("hex")
    const sizeBytes = (await stat(sealed)).size
    await updateRun(run.id, { sha256, sizeBytes })
    log(ctx, `dumped ${mb(sizeBytes)}, sha256 ${sha256.slice(0, 12)}…`)

    // Verified before anything leaves the machine.
    await verify(ctx, { sealed, key: key!, major: snap.major, prerequisites: snap.prerequisites, live, dir })

    const [last] = await sql<{ sizeBytes: number }[]>`
      select size_bytes from backup_runs
      where kind = 'db' and status in ('ok', 'warning') and trigger <> 'reverify' and size_bytes is not null
      order by started_at desc limit 1`
    const drop = shrank(sizeBytes, last?.sizeBytes ?? null, s.backupShrinkWarnPct)
    ctx.checks.size = drop
      ? { ok: false, detail: `${drop}% smaller than the last good backup. Check nothing was deleted by mistake.` }
      : { ok: true, detail: last ? "In line with the last good backup." : "The first good backup." }

    const s3Key = dumpKey(dest, run.id, run.startedAt)
    await step(ctx, "upload")
    await upload(client(dest), dest.bucket, s3Key, createReadStream(sealed), { sha256 })
    await updateRun(run.id, { s3Key })
    await rm(sealed, { force: true })
    await rm(await fetchStored(ctx, dest, s3Key, sha256, dir), { force: true })

    await retention(ctx, s, dest)
    const warn = ctx.checks.size.ok === false || ctx.checks.integrity?.ok === false
    await finish(ctx, warn ? "warning" : "ok")
  } catch (e) {
    await fail(ctx, s, e).catch((x) => console.error("backup: after failure", x))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// Downloads an earlier dump and proves again that it restores to what was
// dumped. `run.sourceRunId` is the dump being checked.
export async function reverifyDb(run: Run) {
  const ctx: Ctx = { run, checks: {}, step: null, t0: Date.now() }
  const s = await readSettings()
  const dir = await mkdtemp(join(tmpdir(), "nimbus-backup-"))
  try {
    const source = run.sourceRunId ? await getRun(run.sourceRunId) : null
    if (!source?.s3Key || !source.sha256 || source.deletedAt)
      throw new StepError("That backup's file is no longer in storage.")
    if (!source.fingerprint)
      throw new StepError("That backup has no recorded fingerprint to compare against.")
    const { dest, key } = setup(s, true)
    // The server version and roles come from the live database today.
    await step(ctx, "snapshot")
    const snap = await openSnapshot(dbUrl())
    await snap.close()
    await updateRun(run.id, { s3Key: source.s3Key, sizeBytes: source.sizeBytes, sha256: source.sha256 })
    const file = await fetchStored(ctx, dest, source.s3Key, source.sha256, dir)
    await verify(ctx, {
      sealed: file,
      key: key!,
      major: snap.major,
      prerequisites: snap.prerequisites,
      live: source.fingerprint,
      dir,
    })
    await finish(ctx, ctx.checks.integrity?.ok === false ? "warning" : "ok")
  } catch (e) {
    await fail(ctx, s, e).catch((x) => console.error("backup: after failure", x))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
