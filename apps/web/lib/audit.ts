import "server-only"

import { eq } from "drizzle-orm"
import type { PgUpdateSetSource } from "drizzle-orm/pg-core"

import { db } from "@/lib/db"
import { auditEvents, settings, user } from "@/lib/db/schema"
import { getSession } from "@/lib/session"

type Settings = typeof settings.$inferSelect

// One audit row, with the signed-in admin as the actor.
export async function audit(
  action: string,
  { targetId, detail }: { targetId?: string; detail?: string } = {}
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
  })
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
