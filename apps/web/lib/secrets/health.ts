// A project's health: computed on the server from decrypted values, returned as verdicts
// only (key names, environments, ages, counts), never a value or a hash.
import "server-only"

import { and, eq, isNotNull, isNull, lte } from "drizzle-orm"

import { db } from "@/lib/db"
import { secretCerts, secretItems, secretTokens } from "@/lib/db/schema"
import { checkSchema } from "./gov-rules"
import { grade, healthScore, isCredentialKey, reusedGroups, weakReason, type Counts } from "./health-rules"
import { openLeakCount } from "./leaks"
import { loadAll, requiredKeys, type Ctx } from "./service"

export type Fix = { label: string; detail: string; view: string; folder?: string; key?: string; tab?: string; href?: string }
export type Section = { id: keyof Counts; title: string; hint: string; items: Fix[] }

const DAY = 86_400_000
export const OLD_DAYS = 180
const EXPIRE_DAYS = 30
const UNUSED_DAYS = 30

export async function projectHealth(c: Ctx, me: string, oldDays = OLD_DAYS) {
  const all = await loadAll(c)
  const envName = new Map(all.envs.map((e) => [e.slug, e.name]))
  const where = (i: (typeof all.items)[number]) => `${envName.get(i.scope.env)}${i.scope.folder ? ` / ${i.scope.folder}` : ""}`
  const open = (i: (typeof all.items)[number]) => ({ view: i.scope.env, folder: i.scope.folder, key: i.row.key })
  const now = Date.now()
  const rows = all.items.map((i) => ({ ...i, key: i.row.key, type: i.row.type }))

  const weak: Fix[] = []
  const old: Fix[] = []
  for (const i of rows) {
    const why = weakReason(i.key, i.value, i.type)
    if (why) weak.push({ label: i.key, detail: `${where(i)}: ${why}`, ...open(i) })
    const age = Math.floor((now - i.row.updatedAt.getTime()) / DAY)
    if (age >= oldDays && isCredentialKey(i.key) && i.value) old.push({ label: i.key, detail: `${where(i)}: not changed in ${age} days`, ...open(i) })
  }
  const reused: Fix[] = reusedGroups(rows).map((g) => ({
    label: [...new Set(g.map((x) => x.key))].join(", "),
    detail: `The same value in ${g.map(where).join(", ")}`,
    ...open(g[0]),
  }))

  // Required keys that are missing, empty or invalid; and keys one environment has that another lacks.
  const reqs = await requiredKeys(c.projectId)
  const missing: Fix[] = []
  for (const e of all.envs)
    for (const rk of reqs.values()) {
      const hit = rows.find((i) => i.scope.env === e.slug && i.scope.folder === "" && i.key === rk.key)
      const bad = !hit ? "missing" : hit.value === "" ? "empty" : checkSchema(rk.kind, rk.pattern, hit.value) ? "doesn't match its rule" : null
      if (bad) missing.push({ label: rk.key, detail: `${e.name}: ${bad}`, view: "overview" })
    }
  const drift: Fix[] = []
  if (all.envs.length > 1) {
    const at = new Map<string, Set<string>>()
    for (const i of rows) at.set(`${i.scope.folder}\0${i.key}`, (at.get(`${i.scope.folder}\0${i.key}`) ?? new Set()).add(i.scope.env))
    for (const [k, envs] of at) {
      const lacking = all.envs.filter((e) => !envs.has(e.slug) && !reqs.has(k.split("\0")[1]))
      if (lacking.length && lacking.length < all.envs.length)
        drift.push({ label: k.split("\0")[1], detail: `Not in ${lacking.map((e) => e.name).join(", ")}`, view: "overview", folder: k.split("\0")[0] })
    }
  }

  // Certificates, API keys and tokens expiring inside 30 days (or already past).
  const soon = new Date(now + EXPIRE_DAYS * DAY)
  const left = (d: Date) => (d.getTime() < now ? "expired" : `expires in ${Math.ceil((d.getTime() - now) / DAY)} days`)
  const expiring: Fix[] = [
    ...(await db.select().from(secretCerts).where(and(eq(secretCerts.projectId, c.projectId), isNull(secretCerts.revokedAt), lte(secretCerts.notAfter, soon)))).map((x) => ({ label: x.name, detail: `Certificate ${left(x.notAfter)}`, view: "certs" })),
    ...(await db.select().from(secretItems).where(and(eq(secretItems.projectId, c.projectId), isNotNull(secretItems.expiresAt), lte(secretItems.expiresAt, soon)))).map((x) => ({ label: x.name, detail: `API key ${left(x.expiresAt!)}`, view: "items" })),
  ]
  const unused: Fix[] = []
  if (c.role === "admin") {
    const toks = await db.select().from(secretTokens).where(and(eq(secretTokens.projectId, c.projectId), isNull(secretTokens.revokedAt)))
    for (const t of toks) {
      if (t.expiresAt && t.expiresAt.getTime() < now) continue
      if (t.expiresAt && t.expiresAt <= soon) expiring.push({ label: t.name, detail: `Machine token ${left(t.expiresAt)}`, view: "access", tab: "tokens" })
      const idle = Math.floor((now - (t.lastUsedAt ?? t.createdAt).getTime()) / DAY)
      if (idle >= UNUSED_DAYS) unused.push({ label: t.name, detail: t.lastUsedAt ? `Last used ${idle} days ago` : `Never used, made ${idle} days ago`, view: "access", tab: "tokens" })
    }
  }
  const leakN = await openLeakCount(me)
  const leaks: Fix[] = leakN ? [{ label: `${leakN} open finding${leakN === 1 ? "" : "s"} in your files`, detail: "Possible secrets Nimbus found in files you own", view: "", href: "/secrets/leaks" }] : []

  const sections: Section[] = [
    { id: "weak", title: "Weak secrets", hint: "Short, common or repetitive values for passwords, tokens and keys.", items: weak },
    { id: "reused", title: "Reused secrets", hint: "One value shared by several keys. A leak of one opens them all.", items: reused },
    { id: "old", title: `Not changed in ${oldDays} days`, hint: "Passwords, tokens and keys that have never been rotated lately.", items: old },
    { id: "missing", title: "Required keys", hint: "Required keys that are missing, empty or against their rule.", items: missing },
    { id: "drift", title: "Environment drift", hint: "Keys that some environments have and others don't.", items: drift },
    { id: "expiring", title: "Expiring soon", hint: "Certificates, API keys and tokens that end within 30 days.", items: expiring },
    { id: "unused", title: "Unused tokens", hint: "Machine tokens nobody has used in 30 days. Revoke what you don't need.", items: unused },
    { id: "leaks", title: "Leaked in files", hint: "Secrets Nimbus found in your uploaded files.", items: leaks },
  ]
  const counts = Object.fromEntries(sections.map((s) => [s.id, s.id === "leaks" ? leakN : s.items.length])) as Counts
  const score = healthScore(counts)
  return { score, grade: grade(score), oldDays, checked: rows.length, sections: sections.map((s) => ({ ...s, items: s.items.slice(0, 50), total: s.id === "leaks" ? leakN : s.items.length })) }
}

