// Domain watch: the certificate a host:port serves now, rechecked by the hourly sweep.
import "server-only"

import { and, asc, eq } from "drizzle-orm"

import { audit } from "@/lib/audit"
import { db } from "@/lib/db"
import { secretWatches } from "@/lib/db/schema"
import { SecretsError, type Ctx } from "./service"
import { liveCert } from "./tls-watch"

const bad = (m: string, status = 400) => new SecretsError(status, m)
const HOST = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$|^[0-9a-f:.]+$/i

const card = (r: typeof secretWatches.$inferSelect) => ({
  id: r.id,
  host: r.host,
  port: r.port,
  subject: r.subject,
  issuer: r.issuer,
  notAfter: r.notAfter?.toISOString() ?? null,
  checkedAt: r.checkedAt?.toISOString() ?? null,
  error: r.error,
})

export async function listWatches(c: Ctx) {
  const rows = await db.select().from(secretWatches).where(eq(secretWatches.projectId, c.projectId)).orderBy(asc(secretWatches.host))
  return rows.map(card)
}

// Fetch the live certificate and store what it says. A failure is stored too, shown on the row.
export async function checkWatch(id: string) {
  const [w] = await db.select().from(secretWatches).where(eq(secretWatches.id, id))
  if (!w) return null
  try {
    const i = await liveCert(w.host, w.port)
    const changed = !w.notAfter || w.notAfter.getTime() !== i.notAfter.getTime()
    const [r] = await db
      .update(secretWatches)
      .set({ subject: i.subject, issuer: i.issuer, notAfter: i.notAfter, checkedAt: new Date(), error: null, ...(changed ? { warnedDays: null } : {}) })
      .where(eq(secretWatches.id, id))
      .returning()
    return r
  } catch (e) {
    const [r] = await db.update(secretWatches).set({ checkedAt: new Date(), error: (e as Error).message.slice(0, 200) }).where(eq(secretWatches.id, id)).returning()
    return r
  }
}

export async function addWatch(c: Ctx, hostRaw: string, port: number) {
  const host = hostRaw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")
  if (!host || host.length > 253 || !HOST.test(host)) throw bad("Enter a host name, like example.com.")
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw bad("Port must be 1 to 65535.")
  const [dup] = await db.select({ id: secretWatches.id }).from(secretWatches).where(and(eq(secretWatches.projectId, c.projectId), eq(secretWatches.host, host), eq(secretWatches.port, port)))
  if (dup) throw bad("Already watching that.", 409)
  const [w] = await db.insert(secretWatches).values({ projectId: c.projectId, host, port }).returning({ id: secretWatches.id })
  await audit("secrets_watch_add", { detail: `${host}:${port}` })
  return card((await checkWatch(w.id))!)
}

export async function recheck(c: Ctx, id: string) {
  const [w] = await db.select({ id: secretWatches.id }).from(secretWatches).where(and(eq(secretWatches.id, id), eq(secretWatches.projectId, c.projectId)))
  if (!w) throw bad("That watch isn't here.", 404)
  return card((await checkWatch(id))!)
}

export async function deleteWatch(c: Ctx, id: string) {
  await db.delete(secretWatches).where(and(eq(secretWatches.id, id), eq(secretWatches.projectId, c.projectId)))
}
