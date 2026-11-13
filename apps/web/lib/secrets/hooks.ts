// What a write sets off: a queued .env push and signed webhooks, per environment.
// Payloads carry names only, never values. Kept free of service.ts (it calls this).
import "server-only"

import { and, eq, inArray } from "drizzle-orm"

import { db } from "@/lib/db"
import {
  secretEnvs,
  secretProjects,
  secretPushTargets,
  secretWebhookDeliveries,
  secretWebhooks,
} from "@/lib/db/schema"
import { enqueue } from "@/lib/redis"

export type HookPayload = {
  event: "secrets.changed" | "test"
  project: { id: string; slug: string; name: string }
  env: { slug: string; name: string }
  keys: string[]
  at: string
}

export async function hookPayload(envId: string, event: HookPayload["event"], keys: string[]) {
  const [row] = await db
    .select({ p: secretProjects, e: secretEnvs })
    .from(secretEnvs)
    .innerJoin(secretProjects, eq(secretProjects.id, secretEnvs.projectId))
    .where(eq(secretEnvs.id, envId))
  if (!row) return null
  return {
    event,
    project: { id: row.p.id, slug: row.p.slug, name: row.p.name },
    env: { slug: row.e.slug, name: row.e.name },
    keys: [...new Set(keys)].sort().slice(0, 200),
    at: new Date().toISOString(),
  } satisfies HookPayload
}

export async function notifyChange(_projectId: string, envIds: string[], keys: string[]) {
  if (!envIds.length) return
  try {
    const pushes = await db
      .select({ envId: secretPushTargets.envId })
      .from(secretPushTargets)
      .where(and(inArray(secretPushTargets.envId, envIds), eq(secretPushTargets.auto, true)))
    for (const p of pushes) await enqueue("secrets-push", { envId: p.envId })
    const hooks = await db
      .select()
      .from(secretWebhooks)
      .where(and(inArray(secretWebhooks.envId, envIds), eq(secretWebhooks.enabled, true)))
    for (const h of hooks) {
      const payload = await hookPayload(h.envId, "secrets.changed", keys)
      if (!payload) continue
      const [d] = await db
        .insert(secretWebhookDeliveries)
        .values({ webhookId: h.id, event: payload.event, payload: JSON.stringify(payload) })
        .returning({ id: secretWebhookDeliveries.id })
      await enqueue("secrets-webhook", { id: d.id })
    }
  } catch (e) {
    // A queue hiccup must not fail the save that already landed.
    console.error("secrets hooks:", e)
  }
}
