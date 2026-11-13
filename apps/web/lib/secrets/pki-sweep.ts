// The PKI half of the hourly sweep: expiry warnings (30, 7, 1 day) for stored
// certificates, API keys and watched domains, Let's Encrypt renewals, domain rechecks.
import "server-only"

import { and, eq, isNotNull, isNull, lte, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { secretCerts, secretItems, secretProjects, secretWatches } from "@/lib/db/schema"
import { renewDue } from "./acme"
import { checkWatch } from "./watch"

type Deps = {
  admins: (projectId: string) => Promise<string[]>
  tell: (to: Iterable<string>, actorId: string | null, text: string, href: string) => Promise<void>
}

const DAYS = [1, 7, 30] as const
const when = (d: number) => (d === 1 ? "a day" : `${d} days`)

export async function pkiSweep({ admins, tell }: Deps) {
  const out = { certs: 0, items: 0, watches: 0, renewed: 0, failed: 0 }
  const name = async (id: string) => (await db.select({ n: secretProjects.name }).from(secretProjects).where(eq(secretProjects.id, id)))[0]?.n ?? "a project"
  const warn = async (projectId: string, text: string, view: string) =>
    tell(await admins(projectId), null, `${text} in ${await name(projectId)}.`, `/secrets/${projectId}?view=${view}`)

  // Renew first, so a renewed certificate isn't warned about.
  const r = await renewDue()
  for (const x of r.renewed) await warn(x.projectId, `Renewed the certificate “${x.name}”`, "certs")
  for (const x of r.failed) await warn(x.projectId, `Couldn't renew “${x.name}” (${x.error.slice(0, 120)})`, "certs")
  out.renewed = r.renewed.length
  out.failed = r.failed.length

  // Domains: look again (the live certificate may have been replaced or have lapsed).
  for (const w of await db.select({ id: secretWatches.id }).from(secretWatches)) await checkWatch(w.id).catch(() => {})

  // Smallest window first so a long-lapsed one is told once, at "a day".
  const soon = (col: typeof secretCerts.notAfter, warned: typeof secretCerts.warnedDays, days: number) =>
    and(isNotNull(col), lte(col, sql`now() + ${`${days} days`}::interval`), sql`coalesce(${warned}, 99) > ${days}`)
  for (const days of DAYS) {
    for (const c of await db.select().from(secretCerts).where(and(isNull(secretCerts.revokedAt), soon(secretCerts.notAfter, secretCerts.warnedDays, days)))) {
      const gone = c.notAfter.getTime() < Date.now()
      await warn(c.projectId, `The certificate “${c.name}” ${gone ? "has expired" : `expires in ${when(days)}`}`, "certs")
      await db.update(secretCerts).set({ warnedDays: days }).where(eq(secretCerts.id, c.id))
      out.certs++
    }
    for (const i of await db.select().from(secretItems).where(soon(secretItems.expiresAt as never, secretItems.warnedDays as never, days))) {
      await warn(i.projectId, `The API key “${i.name}” ${i.expiresAt!.getTime() < Date.now() ? "has expired" : `expires in ${when(days)}`}`, "items")
      await db.update(secretItems).set({ warnedDays: days }).where(eq(secretItems.id, i.id))
      out.items++
    }
    for (const w of await db.select().from(secretWatches).where(soon(secretWatches.notAfter as never, secretWatches.warnedDays as never, days))) {
      await warn(w.projectId, `The certificate served by ${w.host}:${w.port} ${w.notAfter!.getTime() < Date.now() ? "has expired" : `expires in ${when(days)}`}`, "certs")
      await db.update(secretWatches).set({ warnedDays: days }).where(eq(secretWatches.id, w.id))
      out.watches++
    }
  }
  return out
}
