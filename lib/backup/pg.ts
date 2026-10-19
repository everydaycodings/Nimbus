// Postgres for backups: the live database's exported snapshot (so pg_dump and
// the verification read exactly the same data), fingerprints, and pg_dump /
// pg_restore / a throwaway scratch server, all run through Docker from an
// image matching the live server's major version. The host needs only Docker.
// Secrets reach containers through inherited env, never argv (visible in ps).
// Relative imports only: scripts/backup-worker.ts runs this under plain node.
import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { createReadStream } from "node:fs"
import type { Writable } from "node:stream"
import { pipeline } from "node:stream/promises"

import postgres from "postgres"

import { scrub, type Fingerprint } from "../backup-rules.ts"

export const SCHEMAS = ["public", "drizzle"]
const SCRATCH = "nimbus-backup-scratch-"
const image = (major: number) => `postgres:${major}-alpine`

const OBJECTS_SQL = `
select n.nspname || '.' || k.kind as key, k.n::int as n from (
  select relnamespace as ns, 'tables' as kind, count(*) as n from pg_class where relkind in ('r', 'p') group by 1
  union all select c.relnamespace, 'indexes', count(*) from pg_index i join pg_class c on c.oid = i.indexrelid group by 1
  union all select connamespace, 'constraints_' || contype::text, count(*) from pg_constraint group by 1, 2
  union all select pronamespace, 'functions', count(*) from pg_proc p
    where not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e') group by 1
  union all select c.relnamespace, 'triggers', count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal group by 1
  union all select relnamespace, 'views', count(*) from pg_class where relkind in ('v', 'm') group by 1
  union all select c.relnamespace, 'policies', count(*) from pg_policy p join pg_class c on c.oid = p.polrelid group by 1
) k join pg_namespace n on n.oid = k.ns where n.nspname = any($1)`

const TABLES_SQL = `
select n.nspname || '.' || c.relname as name, format('%I.%I', n.nspname, c.relname) as quoted
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'r' and n.nspname = any($1) order by 1`

const SEQUENCES_SQL = `
select schemaname || '.' || sequencename as name, coalesce(last_value, 0)::text as value
from pg_sequences where schemaname = any($1)`

type Conn = postgres.Sql | postgres.ReservedSql

async function fingerprintOn(c: Conn): Promise<Fingerprint> {
  const tables: Fingerprint["tables"] = {}
  for (const { name, quoted } of await c.unsafe(TABLES_SQL, [SCHEMAS])) {
    // ponytail: one md5 per row held in memory per table; fine to tens of millions of rows, sample big tables past that.
    const [r] = await c.unsafe(
      `select count(*)::int as rows, coalesce(md5(string_agg(h, '' order by h)), '') as checksum
       from (select md5(t::text) as h from ${quoted} t) x`
    )
    tables[name] = { rows: r.rows, checksum: r.checksum }
  }
  const objects = Object.fromEntries(
    (await c.unsafe(OBJECTS_SQL, [SCHEMAS])).map((r) => [r.key, r.n])
  )
  const sequences = Object.fromEntries(
    (await c.unsafe(SEQUENCES_SQL, [SCHEMAS])).map((r) => [r.name, r.value])
  )
  return { tables, objects, sequences }
}

const connect = (url: string) =>
  postgres(url, {
    max: 1,
    connect_timeout: 15,
    onnotice: () => {},
    connection: { application_name: "nimbus-backup" },
  })

export type Prerequisites = {
  roles: string[]
  extensions: { name: string; schema: string }[]
}

// A read-only repeatable-read transaction on the live database with its
// snapshot exported. Close it once pg_dump is done.
export async function openSnapshot(url: string) {
  const sql = connect(url)
  const c = await sql.reserve()
  try {
    await c.unsafe("begin isolation level repeatable read read only")
    const [{ id }] = await c`select pg_export_snapshot() as id`
    const [stats] = await c`
      select pg_database_size(current_database())::bigint as size,
             current_setting('server_version_num')::int as version`
    const roles = (
      await c`select rolname as name from pg_roles where rolname !~ '^pg_' order by 1`
    ).map((r) => r.name as string)
    const extensions = (await c`
      select e.extname as name, n.nspname as schema
      from pg_extension e join pg_namespace n on n.oid = e.extnamespace order by 1`) as unknown as Prerequisites["extensions"]
    return {
      snapshot: id as string,
      sizeBytes: Number(stats.size),
      major: Math.floor(stats.version / 10_000),
      prerequisites: { roles, extensions },
      fingerprint: () => fingerprintOn(c),
      async close() {
        await c.unsafe("commit").catch(() => {})
        c.release()
        await sql.end({ timeout: 5 })
      },
    }
  } catch (e) {
    c.release()
    await sql.end({ timeout: 5 })
    throw e
  }
}

export async function readFingerprint(url: string) {
  const sql = connect(url)
  try {
    return await fingerprintOn(sql)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

// The live roles (as nologin) and extensions, so the restore's owners and
// CREATE EXTENSIONs have something to land on.
async function prepareScratch(url: string, p: Prerequisites) {
  const sql = connect(url)
  try {
    for (const role of p.roles)
      await sql.unsafe(
        `do $$ begin if not exists (select 1 from pg_roles where rolname = '${role.replace(/'/g, "''")}') then create role "${role.replace(/"/g, '""')}" nologin; end if; end $$`
      )
    for (const { name, schema } of p.extensions) {
      if (!schema.startsWith("pg_"))
        await sql`create schema if not exists ${sql(schema)}`
      // One the image lacks makes whatever needed it fail the restore visibly.
      await sql`create extension if not exists ${sql(name)} with schema ${sql(schema)}`.catch(
        () => {}
      )
    }
  } finally {
    await sql.end({ timeout: 5 })
  }
}

async function waitFor(url: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const sql = connect(url)
    try {
      await sql`select 1`
      return
    } catch (e) {
      if (Date.now() > deadline) throw e
      await new Promise((r) => setTimeout(r, 500))
    } finally {
      await sql.end({ timeout: 1 })
    }
  }
}

type Run = { code: number; stdout: string; stderr: string }
const STDERR_MAX = 200_000

// Runs docker; stdout goes to `sink` when given, else is collected. Resolves
// on any exit code.
function docker(
  args: string[],
  o: { env?: Record<string, string>; stdin?: string; sink?: Writable } = {}
) {
  return new Promise<Run>((resolve, reject) => {
    const child = spawn("docker", args, {
      env: { ...process.env, ...o.env },
      stdio: ["pipe", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stderr.on("data", (b: Buffer) => {
      if (stderr.length < STDERR_MAX) stderr += b
    })
    const out = o.sink ? pipeline(child.stdout, o.sink) : null
    if (!o.sink) child.stdout.on("data", (b: Buffer) => (stdout += b))
    child.on("error", reject)
    if (o.stdin)
      // A reader may stop early on purpose (pg_restore --list reads only the contents).
      pipeline(createReadStream(o.stdin), child.stdin).catch(
        (e: NodeJS.ErrnoException) => e.code !== "EPIPE" && reject(e)
      )
    else child.stdin.end()
    child.on("close", async (code) => {
      try {
        await out
        resolve({ code: code ?? 1, stdout, stderr })
      } catch (e) {
        reject(e)
      }
    })
  })
}

const firstError = (stderr: string) =>
  scrub(
    stderr.split("\n").find((l) => /error|fatal|could not/i.test(l)) ??
      stderr.split("\n")[0] ??
      ""
  ).slice(0, 500)

export async function dockerAvailable() {
  try {
    return (await docker(["version", "--format", "{{.Server.Version}}"])).code === 0
  } catch {
    return false
  }
}

// pg_dump of SCHEMAS at `snapshot`, custom format, into `sink`.
// ponytail: --network host reaches a DB on the host's localhost on Linux; Docker Desktop needs host.docker.internal in DATABASE_URL.
// The extensions the schemas use (pg_trgm, …) go in too: --schema leaves
// them out, and a restore onto a bare server would then fail.
export async function pgDump(
  url: string,
  major: number,
  snapshot: string,
  extensions: Prerequisites["extensions"],
  sink: Writable
) {
  const run = await docker(
    [
      "run", "--rm", "--network", "host", "-e", "NB_DB_URL", image(major),
      "sh", "-c", 'exec pg_dump --dbname="$NB_DB_URL" "$@"', "pg_dump",
      `--snapshot=${snapshot}`, "--format=custom", "--no-password",
      ...SCHEMAS.map((s) => `--schema=${s}`),
      ...extensions.filter((e) => SCHEMAS.includes(e.schema)).map((e) => `--extension=${e.name}`),
    ],
    { env: { NB_DB_URL: url }, sink }
  )
  if (run.code !== 0) throw new Error(`pg_dump failed: ${firstError(run.stderr)}`)
}

// Starts an empty throwaway Postgres on a random localhost port, ready for
// `restore`. Always `stop` it.
export async function startScratch(major: number, runId: string, p: Prerequisites) {
  const name = `${SCRATCH}${runId}`
  const password = randomBytes(18).toString("base64url")
  const started = await docker(
    ["run", "-d", "--rm", "--name", name, "-e", "POSTGRES_PASSWORD", "-p", "127.0.0.1::5432", image(major)],
    { env: { POSTGRES_PASSWORD: password } }
  )
  if (started.code !== 0)
    throw new Error(`Couldn't start the scratch database: ${firstError(started.stderr)}`)
  const stop = async () => {
    await docker(["rm", "-f", name]).catch(() => {})
  }
  try {
    const port = (await docker(["port", name, "5432/tcp"])).stdout
      .trim()
      .split("\n")[0]
      ?.split(":")
      .pop()
    if (!port) throw new Error("The scratch database has no port.")
    const url = `postgres://postgres:${password}@127.0.0.1:${port}/postgres`
    await waitFor(url, 90_000)
    await prepareScratch(url, p)
    return {
      url,
      // Entries in the dump's table of contents; throws if it can't be read.
      async list(file: string) {
        const r = await docker(["exec", "-i", name, "pg_restore", "--list"], { stdin: file })
        if (r.code !== 0) throw new Error(`The dump can't be read: ${firstError(r.stderr)}`)
        return r.stdout.split("\n").filter((l) => l.trim() && !l.startsWith(";")).length
      },
      // pg_restore's stderr; lib/backup-rules restoreErrors judges it.
      async restore(file: string) {
        return (
          await docker(
            ["exec", "-i", name, "pg_restore", "--username=postgres", "--dbname=postgres", "--no-password"],
            { stdin: file }
          )
        ).stderr
      },
      stop,
    }
  } catch (e) {
    await stop()
    throw e
  }
}

// Scratch containers a worker left behind when it stopped mid-run.
export async function removeOrphanScratch() {
  const ids = (await docker(["ps", "-aq", "--filter", `name=${SCRATCH}`])).stdout
    .split("\n")
    .filter(Boolean)
  if (ids.length) await docker(["rm", "-f", ...ids])
  return ids.length
}
