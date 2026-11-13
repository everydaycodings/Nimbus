// Dynamic database credentials and password rotation (S6a).
//
// A connection holds the admin login (sealed) and a role template. A lease is one
// user Nimbus made from that template; it ends at its expiry through a delayed job
// (the hourly sweep is the backstop). A rotation keeps one secret in step with one
// database user: Nimbus sets a new password there, then writes the secret as a new
// version. Rotation skips change requests in protected environments and the
// admins hear of it (applyOps → changed → envChanged); on failure the secret keeps its old value.
import "server-only"

import { and, desc, eq, isNotNull, isNull, lte } from "drizzle-orm"

import { audit, auditAs } from "@/lib/audit"
import { db } from "@/lib/db"
import { secretDbConnections, secretDbLeases, secretEnvs, secretRotations, secrets, secretMembers, type DbEngine } from "@/lib/db/schema"
import { enqueue } from "@/lib/redis"
import { endSessions, execute, ping, setPassword, userExists, type Target } from "./dyn-drivers"
import {
  DEFAULT_PORT, DEFAULT_TEMPLATE, ENGINES, MAX_TTL_LIMIT, MIN_TTL, USER_RE, checkSyntax, clampTtl, fmtTtl, leaseUrl,
  newPassword, newUsername, otherUser, parseTtl, render, validateTemplate,
} from "./dyn-rules"
import { KEY_RE } from "./consts"
import { SecretsError, applyOps, seal, systemCtx, unseal, type Ctx } from "./service"

const bad = (m: string, status = 400, fields?: Record<string, string>) => new SecretsError(status, m, fields)

// How an action is written to the audit log: the signed-in member, a token, or Nimbus itself.
export type Log = (action: string, detail: string) => Promise<void>
export const sessionLog: Log = (a, d) => audit(a, { detail: d })
const systemLog = (projectId: string): Log => (a, d) => auditAs({ id: null, name: "Nimbus" }, a, d, { projectId })

const notices = () => import("./notices")
async function warnAdmins(projectId: string, text: string, view = "dynamic") {
  const n = await notices()
  await n.tell(await n.admins(projectId), null, text, `/secrets/${projectId}?view=${view}`)
}

// Engine errors can echo the statement; never let a password out in one.
const clean = (e: unknown, ...hide: string[]) => {
  let m = e instanceof Error ? e.message : String(e)
  for (const h of hide) if (h) m = m.split(h).join("•••")
  return m.replace(/\s+/g, " ").slice(0, 300)
}

// ---- Connections --------------------------------------------------------------

type Conn = typeof secretDbConnections.$inferSelect
type Admin = { username: string; password: string }

const adminOf = (c: Ctx, conn: Conn) => JSON.parse(unseal(c, conn.adminEnc)) as Admin
const targetOf = (conn: Conn, a: Admin): Target => ({ engine: conn.engine, host: conn.host, port: conn.port, database: conn.database, tls: conn.tls, username: a.username, password: a.password })
const adminTarget = (c: Ctx, conn: Conn) => targetOf(conn, adminOf(c, conn))

async function loadConn(c: Ctx, id: string) {
  const [conn] = /^[0-9a-f-]{36}$/i.test(id)
    ? await db.select().from(secretDbConnections).where(and(eq(secretDbConnections.id, id), eq(secretDbConnections.projectId, c.projectId)))
    : []
  if (!conn) throw bad("That connection isn't here.", 404)
  return conn
}

const shapeConn = (r: Conn, adminUser: string) => ({
  id: r.id,
  name: r.name,
  engine: r.engine,
  host: r.host,
  port: r.port,
  database: r.database,
  tls: r.tls,
  adminUser,
  createSql: r.createSql,
  revokeSql: r.revokeSql,
  defaultTtl: r.defaultTtl,
  maxTtl: r.maxTtl,
})

export type ConnInput = {
  name?: string
  engine?: string
  host?: string
  port?: number
  database?: string
  tls?: boolean
  adminUser?: string
  adminPassword?: string
  createSql?: string
  revokeSql?: string
  defaultTtl?: string | number
  maxTtl?: string | number
}

// Checks what was given and returns the columns to write (only those that were given).
function connFields(input: ConnInput, engine: DbEngine, fresh: boolean) {
  const errors: Record<string, string> = {}
  const out: Partial<typeof secretDbConnections.$inferInsert> = {}
  if (fresh || input.name !== undefined) {
    const n = (input.name ?? "").trim().slice(0, 60)
    if (!n) errors.name = "Name the connection."
    else out.name = n
  }
  if (fresh || input.host !== undefined) {
    const h = (input.host ?? "").trim()
    if (!h || h.length > 255 || !/^[A-Za-z0-9._:-]+$/.test(h)) errors.host = "Enter a host name or address."
    else out.host = h
  }
  if (fresh || input.port !== undefined) {
    const p = Number(input.port ?? DEFAULT_PORT[engine])
    if (!Number.isInteger(p) || p < 1 || p > 65535) errors.port = "Enter a port from 1 to 65535."
    else out.port = p
  }
  if (input.database !== undefined) {
    const d = input.database.trim().slice(0, 63)
    if (d && !/^[A-Za-z0-9_.-]+$/.test(d)) errors.database = "Letters, numbers and _ . - only."
    else out.database = engine === "redis" ? "" : d
  } else if (fresh) out.database = engine === "redis" ? "" : engine === "mongodb" ? "admin" : ""
  if (input.tls !== undefined) out.tls = Boolean(input.tls)
  for (const [k, col, kind] of [["createSql", "createSql", "create"], ["revokeSql", "revokeSql", "revoke"]] as const) {
    const v = input[k] ?? (fresh ? DEFAULT_TEMPLATE[engine][kind] : undefined)
    if (v === undefined) continue
    const err = validateTemplate(v, kind)
    if (err) errors[k] = err
    else
      try {
        checkSyntax(engine, v)
        out[col] = v
      } catch (e) {
        errors[k] = (e as Error).message
      }
  }
  const ttl = (v: string | number | undefined, field: "defaultTtl" | "maxTtl", fallback: number | null) => {
    if (v === undefined || v === "") return fallback
    const s = parseTtl(v)
    if (!s || s < MIN_TTL || s > MAX_TTL_LIMIT) {
      errors[field] = "Use a time like 30m, 2h or 7d (1 minute to 90 days)."
      return fallback
    }
    return s
  }
  const def = ttl(input.defaultTtl, "defaultTtl", fresh ? 3600 : null)
  const max = ttl(input.maxTtl, "maxTtl", fresh ? 86400 : null)
  if (def !== null) out.defaultTtl = def
  if (max !== null) out.maxTtl = max
  if (Object.keys(errors).length) throw bad("Some fields need fixing.", 422, errors)
  return out
}

export async function listConnections(c: Ctx) {
  const rows = await db.select().from(secretDbConnections).where(eq(secretDbConnections.projectId, c.projectId)).orderBy(secretDbConnections.name)
  return rows.map((r) => shapeConn(r, c.role === "admin" ? adminOf(c, r).username : ""))
}

export async function createConnection(c: Ctx, input: ConnInput, log: Log) {
  if (!ENGINES.includes(input.engine as DbEngine)) throw bad("Pick a database type.", 422, { engine: "Pick a database type." })
  const engine = input.engine as DbEngine
  const fields = connFields(input, engine, true)
  const user = (input.adminUser ?? "").trim()
  const pw = input.adminPassword ?? ""
  const errors: Record<string, string> = {}
  if (engine !== "redis" && !user) errors.adminUser = "Enter the admin user Nimbus signs in as."
  if (engine !== "redis" && !pw) errors.adminPassword = "Enter its password."
  if (Object.keys(errors).length) throw bad("Some fields need fixing.", 422, errors)
  const [dup] = await db.select({ id: secretDbConnections.id }).from(secretDbConnections).where(and(eq(secretDbConnections.projectId, c.projectId), eq(secretDbConnections.name, fields.name!)))
  if (dup) throw bad("A connection with that name exists.", 409, { name: "A connection with that name exists." })
  const [row] = await db
    .insert(secretDbConnections)
    .values({ ...(fields as Required<Pick<typeof fields, "name" | "host" | "port" | "createSql" | "revokeSql" | "defaultTtl" | "maxTtl">>), database: fields.database ?? "", tls: fields.tls ?? false, projectId: c.projectId, engine, adminEnc: seal(c, JSON.stringify({ username: user, password: pw })), createdBy: c.userId || null })
    .returning()
  await log("secrets_dyn_conn_save", `${row.name} (${engine}, ${row.host}:${row.port}): added`)
  return shapeConn(row, user)
}

export async function updateConnection(c: Ctx, id: string, input: ConnInput, log: Log) {
  const conn = await loadConn(c, id)
  const fields = connFields(input, conn.engine, false)
  const a = adminOf(c, conn)
  const next: Admin = { username: input.adminUser?.trim() || a.username, password: input.adminPassword || a.password }
  if (fields.name && fields.name !== conn.name) {
    const [dup] = await db.select({ id: secretDbConnections.id }).from(secretDbConnections).where(and(eq(secretDbConnections.projectId, c.projectId), eq(secretDbConnections.name, fields.name)))
    if (dup) throw bad("A connection with that name exists.", 409, { name: "A connection with that name exists." })
  }
  const [row] = await db
    .update(secretDbConnections)
    .set({ ...fields, adminEnc: seal(c, JSON.stringify(next)) })
    .where(eq(secretDbConnections.id, conn.id))
    .returning()
  await log("secrets_dyn_conn_save", `${row.name}: edited${input.adminPassword ? " (new admin password)" : ""}`)
  return shapeConn(row, next.username)
}

export async function deleteConnection(c: Ctx, id: string, log: Log) {
  const conn = await loadConn(c, id)
  const [live] = await db.select({ id: secretDbLeases.id }).from(secretDbLeases).where(and(eq(secretDbLeases.connectionId, id), isNull(secretDbLeases.revokedAt))).limit(1)
  if (live) throw bad("This connection still has leases that aren't revoked. Revoke them first.", 409)
  const [rot] = await db.select({ id: secretRotations.id }).from(secretRotations).where(eq(secretRotations.connectionId, id)).limit(1)
  if (rot) throw bad("A rotation uses this connection. Remove it first.", 409)
  await db.delete(secretDbConnections).where(eq(secretDbConnections.id, id))
  await log("secrets_dyn_conn_delete", conn.name)
}

export async function testConnection(c: Ctx, id: string, log: Log) {
  const conn = await loadConn(c, id)
  const a = adminOf(c, conn)
  try {
    const version = await ping(targetOf(conn, a))
    await log("secrets_dyn_conn_test", `${conn.name}: connected (${version})`)
    return { ok: true, message: `Connected. ${version}` }
  } catch (e) {
    await log("secrets_dyn_conn_test", `${conn.name}: failed (${clean(e, a.password)})`)
    return { ok: false, message: clean(e, a.password) }
  }
}

// ---- Leases -------------------------------------------------------------------

type Lease = typeof secretDbLeases.$inferSelect

const stateOf = (l: Lease) => (l.revokedAt ? "revoked" : l.error ? "failed" : l.expiresAt.getTime() <= Date.now() ? "expired" : "active")

const shapeLease = (l: Lease, connection: string, engine: DbEngine) => ({
  id: l.id,
  connectionId: l.connectionId,
  connection,
  engine,
  username: l.username,
  issuedBy: l.issuedBy,
  createdAt: l.createdAt.toISOString(),
  expiresAt: l.expiresAt.toISOString(),
  revokedAt: l.revokedAt?.toISOString() ?? null,
  error: l.error,
  state: stateOf(l),
})

export async function listLeases(c: Ctx) {
  const rows = await db
    .select({ l: secretDbLeases, name: secretDbConnections.name, engine: secretDbConnections.engine })
    .from(secretDbLeases)
    .innerJoin(secretDbConnections, eq(secretDbConnections.id, secretDbLeases.connectionId))
    .where(eq(secretDbLeases.projectId, c.projectId))
    .orderBy(desc(secretDbLeases.createdAt))
    .limit(100)
  return rows.map((r) => shapeLease(r.l, r.name, r.engine))
}

const isoSecond = (d: Date) => d.toISOString().replace(/\.\d+Z$/, "Z")

// The lease's own end is delayed-job precise; a missed job is caught by the sweep.
async function scheduleExpiry(l: Pick<Lease, "id" | "expiresAt">) {
  await enqueue("secrets-lease-expire", { id: l.id }, { delay: Math.max(0, l.expiresAt.getTime() - Date.now()) + 1000, jobId: `lease-${l.id}-${l.expiresAt.getTime()}` }).catch((e) => console.error("lease expiry job:", e))
}

export async function generate(c: Ctx, connectionId: string, ttlIn: unknown, issuedBy: string, log: Log) {
  const conn = await loadConn(c, connectionId)
  const want = ttlIn === undefined || ttlIn === null || ttlIn === "" ? conn.defaultTtl : parseTtl(ttlIn)
  if (!want) throw bad("Use a time like 30m, 2h or 7d.", 422, { ttl: "Use a time like 30m, 2h or 7d." })
  const ttl = clampTtl(want, conn.maxTtl)
  const now = new Date()
  const username = newUsername()
  const password = newPassword()
  const expiresAt = new Date(now.getTime() + ttl * 1000)
  const target = adminTarget(c, conn)
  const text = render(conn.createSql, { username, password, expiry: isoSecond(new Date(now.getTime() + conn.maxTtl * 1000)) })
  const [lease] = await db
    .insert(secretDbLeases)
    .values({ projectId: c.projectId, connectionId: conn.id, username, passwordEnc: seal(c, password), issuedBy, expiresAt })
    .returning()
  try {
    await execute(target, text)
  } catch (e) {
    // Part of the template may have run: take back whatever exists.
    await execute(target, render(conn.revokeSql, { username })).catch(() => {})
    await db.delete(secretDbLeases).where(eq(secretDbLeases.id, lease.id))
    await log("secrets_dyn_lease", `${conn.name}: couldn't create a user (${clean(e, password)})`)
    throw bad(`The database refused: ${clean(e, password)}`, 502)
  }
  await scheduleExpiry(lease)
  await log("secrets_dyn_lease", `${conn.name}: issued ${username} for ${fmtTtl(ttl)}, to ${issuedBy}`)
  const a = adminOf(c, conn)
  return {
    lease: shapeLease(lease, conn.name, conn.engine),
    username,
    password,
    host: conn.host,
    port: conn.port,
    database: conn.database,
    tls: conn.tls,
    engine: conn.engine,
    url: leaseUrl(conn.engine, { host: conn.host, port: conn.port, database: conn.database, username, password, tls: conn.tls }),
    ttl,
    expiresAt: lease.expiresAt.toISOString(),
    adminUser: c.role === "admin" ? a.username : undefined,
  }
}

async function loadLease(c: Ctx, id: string) {
  const [row] = /^[0-9a-f-]{36}$/i.test(id)
    ? await db.select({ l: secretDbLeases, conn: secretDbConnections }).from(secretDbLeases).innerJoin(secretDbConnections, eq(secretDbConnections.id, secretDbLeases.connectionId)).where(and(eq(secretDbLeases.id, id), eq(secretDbLeases.projectId, c.projectId)))
    : []
  if (!row) throw bad("That lease isn't here.", 404)
  return row
}

export async function revealLease(c: Ctx, id: string, log: Log) {
  const { l, conn } = await loadLease(c, id)
  if (stateOf(l) !== "active") throw bad("This lease has ended; its password is gone.", 410)
  const password = unseal(c, l.passwordEnc)
  await log("secrets_dyn_reveal", `${conn.name}: showed the password of ${l.username}`)
  return {
    username: l.username,
    password,
    host: conn.host,
    port: conn.port,
    database: conn.database,
    engine: conn.engine,
    expiresAt: l.expiresAt.toISOString(),
    url: leaseUrl(conn.engine, { host: conn.host, port: conn.port, database: conn.database, username: l.username, password, tls: conn.tls }),
  }
}

export async function renewLease(c: Ctx, id: string, ttlIn: unknown, log: Log) {
  const { l, conn } = await loadLease(c, id)
  if (stateOf(l) !== "active") throw bad("Only a running lease can be renewed.", 409)
  const want = ttlIn === undefined || ttlIn === "" || ttlIn === null ? conn.defaultTtl : parseTtl(ttlIn)
  if (!want) throw bad("Use a time like 30m, 2h or 7d.", 422, { ttl: "Use a time like 30m, 2h or 7d." })
  const ceiling = l.createdAt.getTime() + conn.maxTtl * 1000
  const next = Math.min(Date.now() + want * 1000, ceiling)
  if (next <= l.expiresAt.getTime() + 1000)
    throw bad(next >= ceiling ? `This lease is at its maximum life (${fmtTtl(conn.maxTtl)} from issue).` : "It already runs at least that long.", 409)
  const [row] = await db.update(secretDbLeases).set({ expiresAt: new Date(next) }).where(eq(secretDbLeases.id, id)).returning()
  await scheduleExpiry(row)
  await log("secrets_dyn_renew", `${conn.name}: ${l.username} now ends ${row.expiresAt.toISOString()}`)
  return shapeLease(row, conn.name, conn.engine)
}

// Idempotent: a user that's already gone counts as revoked.
async function endLease(c: Ctx, conn: Conn, l: Lease, why: string, log: Log) {
  const target = adminTarget(c, conn)
  try {
    await execute(target, render(conn.revokeSql, { username: l.username })).catch((e) => {
      if (!/not found|does not exist|UserNotFound/i.test(String(e?.message))) throw e
    })
    await endSessions(target, l.username).catch(() => {})
  } catch (e) {
    const first = !l.error
    await db.update(secretDbLeases).set({ error: clean(e) }).where(eq(secretDbLeases.id, l.id))
    await log("secrets_dyn_revoke", `${conn.name}: couldn't revoke ${l.username} (${clean(e)})`)
    if (first) await warnAdmins(c.projectId, `Couldn't revoke the database user ${l.username} (${conn.name}): ${clean(e)}`)
    throw bad(`The database refused: ${clean(e)}`, 502)
  }
  await db.update(secretDbLeases).set({ revokedAt: new Date(), error: null }).where(eq(secretDbLeases.id, l.id))
  await log("secrets_dyn_revoke", `${conn.name}: ${l.username} revoked (${why})`)
}

export async function revokeLease(c: Ctx, id: string, log: Log) {
  const { l, conn } = await loadLease(c, id)
  if (l.revokedAt) throw bad("That lease is already revoked.", 409)
  await endLease(c, conn, l, "revoked by hand", log)
}

// The delayed job. Throws so the queue tries again; a renewed lease is left alone.
export async function expireLease(id: string) {
  const [row] = await db.select({ l: secretDbLeases, conn: secretDbConnections }).from(secretDbLeases).innerJoin(secretDbConnections, eq(secretDbConnections.id, secretDbLeases.connectionId)).where(eq(secretDbLeases.id, id))
  if (!row || row.l.revokedAt || row.l.expiresAt.getTime() > Date.now() + 2000) return
  const c = await systemCtx(row.l.projectId)
  if (c) await endLease(c, row.conn, row.l, "expired", systemLog(c.projectId))
}

// ---- Rotations ----------------------------------------------------------------

type Rot = typeof secretRotations.$inferSelect

const shapeRot = (r: Rot, extra: { key: string; env: string; folder: string | null; connection: string; engine: DbEngine }) => ({
  id: r.id,
  secretId: r.secretId,
  ...extra,
  connectionId: r.connectionId,
  username: r.username,
  usernameB: r.usernameB,
  usernameKey: r.usernameKey,
  mode: r.usernameB ? ("alternate" as const) : ("single" as const),
  active: r.active,
  intervalDays: r.intervalDays,
  nextAt: r.nextAt?.toISOString() ?? null,
  lastAt: r.lastAt?.toISOString() ?? null,
  error: r.error,
})

export async function listRotations(c: Ctx) {
  const rows = await db
    .select({ r: secretRotations, key: secrets.key, env: secretEnvs.name, folderId: secrets.folderId, conn: secretDbConnections.name, engine: secretDbConnections.engine })
    .from(secretRotations)
    .innerJoin(secrets, eq(secrets.id, secretRotations.secretId))
    .innerJoin(secretEnvs, eq(secretEnvs.id, secrets.envId))
    .innerJoin(secretDbConnections, eq(secretDbConnections.id, secretRotations.connectionId))
    .where(eq(secretRotations.projectId, c.projectId))
    .orderBy(secretEnvs.name, secrets.key)
  return rows.map((x) => shapeRot(x.r, { key: x.key, env: x.env, folder: x.folderId, connection: x.conn, engine: x.engine }))
}

export type RotInput = { secretId?: string; connectionId?: string; username?: string; mode?: string; usernameB?: string; usernameKey?: string; intervalDays?: number | null }

async function rotFields(c: Ctx, input: RotInput, conn: Conn) {
  const errors: Record<string, string> = {}
  const username = (input.username ?? "").trim()
  if (!USER_RE.test(username)) errors.username = "Enter the database user (letters, numbers, _ . -)."
  const alt = input.mode === "alternate"
  let usernameB: string | null = null
  let usernameKey: string | null = null
  if (alt) {
    if (conn.engine !== "postgres" && conn.engine !== "mysql") errors.mode = "Two-user rotation works with PostgreSQL and MySQL."
    usernameB = (input.usernameB ?? "").trim()
    if (!USER_RE.test(usernameB)) errors.usernameB = "Enter the second database user."
    else if (usernameB === username) errors.usernameB = "The second user must differ from the first."
    usernameKey = (input.usernameKey ?? "").trim()
    if (!KEY_RE.test(usernameKey)) errors.usernameKey = "Name the secret that holds the user name (letters, numbers, _)."
  }
  const days = input.intervalDays === null || input.intervalDays === undefined ? null : Number(input.intervalDays)
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > 365)) errors.intervalDays = "Use 1 to 365 days, or leave it empty to rotate by hand."
  if (Object.keys(errors).length) throw bad("Some fields need fixing.", 422, errors)
  const t = adminTarget(c, conn)
  for (const [field, u] of [["username", username], ["usernameB", usernameB]] as const) {
    if (!u) continue
    let found: boolean
    try {
      found = await userExists(t, u)
    } catch (e) {
      throw bad(`Couldn't reach the database: ${clean(e, t.password)}`, 502)
    }
    if (!found) throw bad(`The database has no user “${u}”.`, 422, { [field]: "No such user on that database." })
  }
  return { username, usernameB, usernameKey, intervalDays: days }
}

export async function createRotation(c: Ctx, input: RotInput, log: Log) {
  const conn = await loadConn(c, String(input.connectionId ?? ""))
  const [sec] = /^[0-9a-f-]{36}$/i.test(String(input.secretId))
    ? await db.select({ s: secrets, env: secretEnvs.name }).from(secrets).innerJoin(secretEnvs, eq(secretEnvs.id, secrets.envId)).where(and(eq(secrets.id, input.secretId!), eq(secrets.projectId, c.projectId), isNull(secrets.deletedAt)))
    : []
  if (!sec) throw bad("Pick the secret to rotate.", 422, { secretId: "Pick a secret." })
  const [dup] = await db.select({ id: secretRotations.id }).from(secretRotations).where(eq(secretRotations.secretId, sec.s.id))
  if (dup) throw bad("That secret already has a rotation.", 409)
  const f = await rotFields(c, input, conn)
  const [row] = await db
    .insert(secretRotations)
    .values({ projectId: c.projectId, secretId: sec.s.id, connectionId: conn.id, ...f, active: f.usernameB ? f.username : null, nextAt: f.intervalDays ? new Date(Date.now() + f.intervalDays * 86_400_000) : null, createdBy: c.userId || null })
    .returning()
  await log("secrets_dyn_rotation_save", `${sec.env} / ${sec.s.key}: rotates ${f.usernameB ? `${f.username} and ${f.usernameB} in turn` : f.username} on ${conn.name}${f.intervalDays ? ` every ${f.intervalDays} days` : " by hand"}`)
  return { id: row.id }
}

async function loadRot(c: Ctx, id: string) {
  const [row] = /^[0-9a-f-]{36}$/i.test(id)
    ? await db.select({ r: secretRotations, conn: secretDbConnections }).from(secretRotations).innerJoin(secretDbConnections, eq(secretDbConnections.id, secretRotations.connectionId)).where(and(eq(secretRotations.id, id), eq(secretRotations.projectId, c.projectId)))
    : []
  if (!row) throw bad("That rotation isn't here.", 404)
  return row
}

export async function updateRotation(c: Ctx, id: string, input: RotInput, log: Log) {
  const { r, conn } = await loadRot(c, id)
  const f = await rotFields(c, { username: r.username, mode: r.usernameB ? "alternate" : "single", usernameB: r.usernameB ?? undefined, usernameKey: r.usernameKey ?? undefined, ...input }, conn)
  await db
    .update(secretRotations)
    .set({ ...f, active: f.usernameB ? (r.active && [f.username, f.usernameB].includes(r.active) ? r.active : f.username) : null, nextAt: f.intervalDays ? new Date(Date.now() + f.intervalDays * 86_400_000) : null })
    .where(eq(secretRotations.id, id))
  await log("secrets_dyn_rotation_save", `${conn.name}: changed the rotation of ${f.username}`)
}

export async function deleteRotation(c: Ctx, id: string, log: Log) {
  const { r } = await loadRot(c, id)
  await db.delete(secretRotations).where(eq(secretRotations.id, id))
  await log("secrets_dyn_rotation_delete", `stopped rotating ${r.username}`)
}

// The caller's ctx, but acting as a project admin who still exists (written versions name them).
async function writerCtx(projectId: string, preferred: string | null) {
  const c = await systemCtx(projectId)
  if (!c) throw bad("That project is gone.", 404)
  const ids = (await db.select({ u: secretMembers.userId }).from(secretMembers).where(and(eq(secretMembers.projectId, projectId), eq(secretMembers.role, "admin")))).map((x) => x.u)
  const who = preferred && ids.includes(preferred) ? preferred : ids[0]
  if (!who) throw bad("This project has no admin to write the new version as.", 409)
  return { ...c, userId: who }
}

// Changes the password on the database, then the secret (a new version "rotate").
// A failure keeps the secret's old value and is shown on the rotation and told to the admins.
export async function rotate(id: string, log: Log) {
  const [row] = await db.select({ r: secretRotations, conn: secretDbConnections }).from(secretRotations).innerJoin(secretDbConnections, eq(secretDbConnections.id, secretRotations.connectionId)).where(eq(secretRotations.id, id))
  if (!row) throw bad("That rotation isn't here.", 404)
  const { r, conn } = row
  const c = await writerCtx(r.projectId, r.createdBy)
  const [sec] = await db.select().from(secrets).where(and(eq(secrets.id, r.secretId), isNull(secrets.deletedAt)))
  const fail = async (m: string): Promise<never> => {
    await db.update(secretRotations).set({ error: m }).where(eq(secretRotations.id, id))
    await log("secrets_dyn_rotate", `${r.username}: failed, the secret keeps its old value (${m})`)
    if (!r.error) await warnAdmins(r.projectId, `Couldn't rotate the password of ${r.username} (${conn.name}): ${m}. The secret keeps its old value.`)
    throw bad(`Rotation failed: ${m}`, 502)
  }
  if (!sec) return fail("The secret is in the trash or gone.")
  const a = adminOf(c, conn)
  const target = targetOf(conn, a)
  const next = r.usernameB ? otherUser(r.active, r.username, r.usernameB) : r.username
  const password = newPassword()
  const old = unseal(c, sec.valueEnc)
  try {
    await setPassword(target, next, password)
  } catch (e) {
    return fail(clean(e, password, a.password))
  }
  try {
    const ops = [{ id: sec.id, key: sec.key, value: password }, ...(r.usernameKey ? [{ key: r.usernameKey, value: next }] : [])]
    await applyOps(c, sec.envId, sec.folderId, ops, [], "merge", { direct: true, action: "rotate", via: "rotate" })
  } catch (e) {
    // The database has the new password but the secret doesn't: put the old one back where that's the same user.
    if (!r.usernameB && old) await setPassword(target, next, old).catch(() => {})
    return fail(`the new value couldn't be saved (${clean(e, password)})`)
  }
  await db
    .update(secretRotations)
    .set({ lastAt: new Date(), error: null, active: r.usernameB ? next : null, nextAt: r.intervalDays ? new Date(Date.now() + r.intervalDays * 86_400_000) : null })
    .where(eq(secretRotations.id, id))
  await log("secrets_dyn_rotate", `${sec.key}: new password for ${next} on ${conn.name}, saved as a new version`)
  return { user: next }
}

export async function rotateNow(c: Ctx, id: string, log: Log) {
  await loadRot(c, id)
  return rotate(id, log)
}

// ---- Sweep --------------------------------------------------------------------

// Hourly backstop: leases whose job went missing, and rotations that are due.
export async function dynSweep() {
  const out = { revoked: 0, rotated: 0, failed: 0 }
  const ended = await db.select({ id: secretDbLeases.id }).from(secretDbLeases).where(and(isNull(secretDbLeases.revokedAt), lte(secretDbLeases.expiresAt, new Date())))
  for (const l of ended) {
    try {
      await expireLease(l.id)
      out.revoked++
    } catch {
      out.failed++
    }
  }
  const due = await db.select({ id: secretRotations.id, projectId: secretRotations.projectId }).from(secretRotations).where(and(isNotNull(secretRotations.nextAt), lte(secretRotations.nextAt, new Date())))
  for (const r of due) {
    try {
      await rotate(r.id, systemLog(r.projectId))
      out.rotated++
    } catch {
      out.failed++
    }
  }
  return out
}
