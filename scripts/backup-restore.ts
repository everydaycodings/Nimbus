// Restores a database backup downloaded from Admin → Backups → History.
//
//   npm run backup:restore -- <file.dump.enc> <target database url>
//   npm run backup:restore -- <file.dump.enc> --out <file.dump>   (decrypt only)
//
// The target must be an empty database: create a fresh one, restore into it,
// check it, then point DATABASE_URL at it. Needs BACKUP_ENCRYPTION_KEY (the
// one the backup was made with) and Docker.
import { spawn } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import postgres from "postgres"

import { restoreErrors } from "../lib/backup-rules.ts"
import { decryptFile, requireKey } from "../lib/backup/file-crypto.ts"

const [file, target, out] = process.argv.slice(2)
if (!file || !target || (target === "--out" && !out)) {
  console.error("Usage: npm run backup:restore -- <file.dump.enc> <target database url | --out file.dump>")
  process.exit(1)
}
const key = requireKey()

if (target === "--out") {
  await decryptFile(file, out, key)
  console.log(`Decrypted to ${out}. Restore it with: pg_restore --no-owner --dbname=<url> ${out}`)
  process.exit(0)
}

const sql = postgres(target, { max: 1, onnotice: () => {} })
const [{ tables, major }] = await sql`
  select (select count(*)::int from pg_tables where schemaname = 'public') as tables,
         current_setting('server_version_num')::int / 10000 as major`
if (tables) {
  console.error(`The target already has ${tables} tables. Restore into an empty database.`)
  process.exit(1)
}

const dir = await mkdtemp(join(tmpdir(), "nimbus-restore-"))
try {
  const plain = join(dir, "backup.dump")
  await decryptFile(file, plain, key)
  console.log("Decrypted; the file is intact. Restoring…")
  // Mounted read-only into a pg_restore matching the target's major version.
  let stderr = ""
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "docker",
      [
        "run", "--rm", "--network", "host", "-v", `${dir}:/backup:ro`, "-e", "NB_DB_URL",
        `postgres:${major}-alpine`, "sh", "-c",
        'exec pg_restore --no-owner --no-privileges --dbname="$NB_DB_URL" /backup/backup.dump',
      ],
      { env: { ...process.env, NB_DB_URL: target }, stdio: ["ignore", "inherit", "pipe"] }
    )
    child.stderr.on("data", (b: Buffer) => (stderr += b))
    child.on("error", reject).on("close", () => resolve())
  })
  // The same rules the backup's own verification restore passed.
  const { fatal } = restoreErrors(stderr)
  if (fatal.length) {
    console.error(fatal.join("\n"))
    throw new Error(`pg_restore hit ${fatal.length} error(s); see above.`)
  }
  const counts = await sql`
    select relname as name, n_live_tup::int as rows from pg_stat_user_tables
    where schemaname = 'public' order by relname`
  console.log(`Restored ${counts.length} tables. Point DATABASE_URL at the new database when you've checked it.`)
} finally {
  await rm(dir, { recursive: true, force: true })
  await sql.end()
}
