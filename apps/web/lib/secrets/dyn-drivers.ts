// Talks to the databases: runs a rendered template, sets a password, checks a user exists.
// One short-lived connection per call, closed in `finally`. Relative imports only so
// node --test (the Docker integration test) can load it.
import { Redis } from "ioredis"
import tls from "node:tls"
import { MongoClient } from "mongodb"
import mysql from "mysql2/promise"
import postgres from "postgres"

import { parseMongo, quoteIdent, quoteLiteral, splitRedis, splitSql, type Engine } from "./dyn-rules.ts"

export type Target = {
  engine: Engine
  host: string
  port: number
  database: string
  tls: boolean
  // PEM of the CA that signed the server certificate (private CAs); default roots otherwise.
  ca?: string
  username: string
  password: string
}

const TIMEOUT = 10_000

// TLS options: the connection's CA (or the default roots) and a name check against the host we
// dialled. Drivers that hand tls a bare socket would otherwise check "localhost" for an IP host.
const tlsOpts = (t: Target) => ({ ...(t.ca ? { ca: t.ca } : {}), checkServerIdentity: (_: string, cert: tls.PeerCertificate) => tls.checkServerIdentity(t.host, cert) })

// Turns a certificate verification failure into something an admin can act on.
export function tlsError(e: unknown, t: Pick<Target, "host" | "ca">): unknown {
  const code = (e as { code?: string })?.code ?? ""
  const msg = e instanceof Error ? e.message : ""
  const fix = t.ca ? "Check the CA certificate on this connection." : "If it uses a private CA, paste that CA's certificate (PEM) into “CA certificate” on this connection."
  if (/SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER|self.signed|unable to verify/i.test(code + msg)) return new Error(`The database's certificate isn't trusted (${(msg || code).replace(/;\s*if the root CA.*$/i, "")}). ${fix}`)
  if (code === "CERT_HAS_EXPIRED" || /certificate has expired/i.test(msg)) return new Error(`The database's certificate has expired. ${fix}`)
  if (code === "ERR_TLS_CERT_ALTNAME_INVALID" || /altnames|does not match|hostname/i.test(msg) && /cert/i.test(msg)) return new Error(`The database's certificate doesn't match the host “${t.host}” (${msg}).`)
  return e
}

async function withPg<T>(t: Target, fn: (sql: ReturnType<typeof postgres>) => Promise<T>) {
  const sql = postgres({
    host: t.host,
    port: t.port,
    database: t.database || "postgres",
    username: t.username,
    password: t.password,
    ssl: t.tls ? tlsOpts(t) : false,
    max: 1,
    connect_timeout: TIMEOUT / 1000,
    onnotice: () => {},
  })
  try {
    return await fn(sql)
  } catch (e) {
    throw tlsError(e, t)
  } finally {
    await sql.end({ timeout: 2 })
  }
}

async function withMysql<T>(t: Target, fn: (c: mysql.Connection) => Promise<T>) {
  const c = await mysql
    .createConnection({
      host: t.host,
      port: t.port,
      user: t.username,
      password: t.password,
      database: t.database || undefined,
      // mysql2 checks the name only for host names, and only with verifyIdentity (not for IPs: the CA still pins the chain).
      ssl: t.tls ? { ...(t.ca ? { ca: t.ca } : {}), verifyIdentity: true } : undefined,
      connectTimeout: TIMEOUT,
    })
    .catch((e) => {
      throw tlsError(e, t)
    })
  try {
    return await fn(c)
  } finally {
    await c.end().catch(() => {})
  }
}

async function withRedis<T>(t: Target, fn: (r: Redis) => Promise<T>) {
  const r = new Redis({
    host: t.host,
    port: t.port,
    username: t.username || undefined,
    password: t.password || undefined,
    tls: t.tls ? tlsOpts(t) : undefined,
    connectTimeout: TIMEOUT,
    lazyConnect: true,
    enableReadyCheck: false,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  })
  // ioredis only says "Connection is closed"; the TLS reason arrives as an error event.
  let reason: unknown
  r.on("error", (e) => (reason ??= e))
  try {
    await r.connect()
    return await fn(r)
  } catch (e) {
    // The error event can land just after connect() rejects.
    if (!reason) await new Promise((r) => setTimeout(r, 100))
    throw tlsError(reason ?? e, t)
  } finally {
    r.disconnect()
  }
}

async function withMongo<T>(t: Target, fn: (db: ReturnType<MongoClient["db"]>) => Promise<T>) {
  const c = new MongoClient(`mongodb://${t.host.includes(":") ? `[${t.host}]` : t.host}:${t.port}`, {
    auth: { username: t.username, password: t.password },
    authSource: t.database || "admin",
    tls: t.tls,
    ...(t.tls && t.ca ? { ca: t.ca } : {}),
    directConnection: true,
    serverSelectionTimeoutMS: TIMEOUT,
    connectTimeoutMS: TIMEOUT,
  })
  try {
    await c.connect()
    return await fn(c.db(t.database || "admin"))
  } catch (e) {
    throw tlsError(e, t)
  } finally {
    await c.close().catch(() => {})
  }
}

// Connects and says what answered (the version), or throws.
export async function ping(t: Target): Promise<string> {
  switch (t.engine) {
    case "postgres":
      return withPg(t, async (s) => String((await s`select version() as v`)[0].v).split(",")[0])
    case "mysql":
      return withMysql(t, async (c) => `MySQL ${String(((await c.query("select version() as v")) as unknown as [{ v: string }[]])[0][0].v)}`)
    case "redis":
      // A limited user can't run INFO; having connected means the login worked.
      return withRedis(t, async (r) => `Redis ${/redis_version:(\S+)/.exec(await r.info("server").catch(() => ""))?.[1] ?? ""}`.trim())
    case "mongodb":
      return withMongo(t, async (db) => `MongoDB ${String((await db.admin().serverInfo()).version)}`)
  }
}

// Runs rendered statements (create or revoke) as the admin.
export async function execute(t: Target, text: string) {
  switch (t.engine) {
    case "postgres":
      // Simple protocol, so several statements go as one message.
      return withPg(t, async (s) => void (await s.unsafe(text).simple()))
    case "mysql":
      return withMysql(t, async (c) => {
        for (const st of splitSql(text)) await c.query(st)
      })
    case "redis":
      return withRedis(t, async (r) => {
        for (const [cmd, ...args] of splitRedis(text)) await r.call(cmd, ...args)
      })
    case "mongodb": {
      const cmds = parseMongo(text)
      return withMongo(t, async (db) => {
        for (const cmd of cmds) await db.command(cmd)
      })
    }
  }
}

export async function userExists(t: Target, name: string): Promise<boolean> {
  switch (t.engine) {
    case "postgres":
      return withPg(t, async (s) => (await s`select 1 from pg_roles where rolname = ${name}`).length > 0)
    case "mysql":
      return withMysql(t, async (c) => ((await c.query("select 1 from mysql.user where User = ?", [name])) as unknown as [unknown[]])[0].length > 0)
    case "redis":
      return withRedis(t, async (r) => (await r.call("ACL", "GETUSER", name)) !== null)
    case "mongodb":
      return withMongo(t, async (db) => ((await db.command({ usersInfo: name })) as { users: unknown[] }).users.length > 0)
  }
}

// Sets a new password on an existing user. Refuses to create one (Redis would).
export async function setPassword(t: Target, name: string, password: string) {
  if (!(await userExists(t, name))) throw new Error(`The database has no user “${name}”.`)
  switch (t.engine) {
    case "postgres":
      return withPg(t, async (s) => void (await s.unsafe(`ALTER ROLE ${quoteIdent("postgres", name)} WITH PASSWORD ${quoteLiteral("postgres", password)}`).simple()))
    case "mysql":
      return withMysql(t, async (c) => {
        const [hosts] = (await c.query("select Host from mysql.user where User = ?", [name])) as unknown as [{ Host: string }[]]
        for (const h of hosts) await c.query("ALTER USER ?@? IDENTIFIED BY ?", [name, h.Host, password])
      })
    case "redis":
      return withRedis(t, async (r) => void (await r.call("ACL", "SETUSER", name, "resetpass", `>${password}`)))
    case "mongodb":
      return withMongo(t, async (db) => void (await db.command({ updateUser: name, pwd: password })))
  }
}

// After a revoke: MySQL keeps a dropped user's open sessions, so end them.
export async function endSessions(t: Target, name: string) {
  if (t.engine !== "mysql") return
  await withMysql(t, async (c) => {
    const [rows] = (await c.query("select ID from information_schema.processlist where USER = ?", [name])) as unknown as [{ ID: number }[]]
    for (const r of rows) await c.query(`KILL ${Number(r.ID)}`).catch(() => {})
  })
}
