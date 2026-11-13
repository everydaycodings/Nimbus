import "server-only"

import { eq } from "drizzle-orm"
import { headers } from "next/headers"
import type { PgUpdateSetSource } from "drizzle-orm/pg-core"

import { db } from "@/lib/db"
import { auditEvents, settings, user } from "@/lib/db/schema"
import { getSession } from "@/lib/session"
import { auditScope } from "@/lib/secrets/audit-ctx"

type Settings = typeof settings.$inferSelect

// Where the request came from, for the Secrets audit tab. Empty outside a request.
export async function origin() {
  try {
    const h = await headers()
    const ip = h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || null
    const ua = h.get("user-agent") ?? ""
    const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : /curl|node|undici|python|go-http/i.test(ua) ? ua.split(/[ /]/)[0] : ua ? "Other" : ""
    const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : ""
    return { ip, device: [browser, os].filter(Boolean).join(" on ") || null }
  } catch {
    return { ip: null, device: null }
  }
}

// One audit row, with the signed-in admin as the actor. Inside a Secrets project
// request it also records the project, environment, IP and device.
export async function audit(
  action: string,
  { targetId, detail, env }: { targetId?: string; detail?: string; env?: string } = {}
) {
  const me = (await getSession())?.user
  if (!me) return
  const [target] = targetId
    ? await db
        .select({ name: user.name, email: user.email })
        .from(user)
        .where(eq(user.id, targetId))
    : []
  await db.insert(auditEvents).values({
    actorId: me.id,
    actorName: me.name || me.email,
    action,
    targetId: targetId ?? null,
    targetName: target ? target.name || target.email : null,
    detail: detail ?? null,
    ...(await scoped(action, env)),
  })
}

async function scoped(action: string, env?: string) {
  const scope = auditScope.getStore()
  if (!scope && !action.startsWith("secrets_")) return {}
  return { projectId: scope?.projectId ?? null, env: env ?? scope?.env ?? null, ...(await origin()) }
}

const SECRET = /password|secret|apikey/i
const show = (v: unknown) => {
  const s = v instanceof Date ? v.toISOString() : JSON.stringify(v ?? null)
  return s.length > 80 ? `${s.slice(0, 77)}…` : s
}

// "signupMode: "open" → "closed"" for each changed key; secrets only say "changed".
export function settingsDiff(
  before: Partial<Settings>,
  after: Partial<Settings>
) {
  return Object.entries(after)
    .filter(
      ([k, v]) =>
        k !== "updatedAt" && show(v) !== show(before[k as keyof Settings])
    )
    .map(([k, v]) =>
      SECRET.test(k)
        ? `${k} changed`
        : `${k}: ${show(before[k as keyof Settings])} → ${show(v)}`
    )
}

// Every admin settings write goes through here, so each change is logged.
// Diffs the saved row, so SQL values (array_append) show their result.
export async function saveSettings(values: PgUpdateSetSource<typeof settings>) {
  const [before] = await db.select().from(settings)
  const [after] = await db.update(settings).set(values).returning()
  if (!before || !after) return
  const keys = Object.keys(values) as (keyof Settings)[]
  const changed = settingsDiff(
    before,
    Object.fromEntries(keys.map((k) => [k, after[k]]))
  )
  if (changed.length) await audit("settings", { detail: changed.join("; ") })
}

// An audit row for an actor who isn't the signed-in session: a machine token
// (no member) or a CLI token (a member, named).
export async function auditAs(
  actor: { id: string | null; name: string },
  action: string,
  detail?: string,
  extra?: { projectId?: string; env?: string; ip?: string | null }
) {
  await db.insert(auditEvents).values({
    actorId: actor.id,
    actorName: actor.name,
    action,
    detail: detail ?? null,
    projectId: extra?.projectId ?? null,
    env: extra?.env ?? null,
    ip: extra?.ip ?? null,
    device: extra?.ip ? "CLI or token" : null,
  })
}
