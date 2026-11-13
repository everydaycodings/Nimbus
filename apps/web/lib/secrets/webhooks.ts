// Per-environment webhooks: a URL and a secret, a signed POST naming the changed keys
// (never values), a delivery log, a Test button. The queue retries failures.
import "server-only"

import { createHmac, randomBytes } from "node:crypto"

import { and, desc, eq, inArray } from "drizzle-orm"

import { db } from "@/lib/db"
import { secretEnvs, secretWebhookDeliveries, secretWebhooks } from "@/lib/db/schema"
import { hookPayload } from "./hooks"
import { openValue, sealValue } from "./kms"
import { SecretsError, systemCtx, type Ctx } from "./service"

export const sign = (secret: string, body: string) =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`

const checkUrl = (raw: string) => {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    throw new SecretsError(400, "Enter a full URL, like https://example.com/hook.")
  }
  if (!/^https?:$/.test(u.protocol) || raw.length > 500)
    throw new SecretsError(400, "The URL must start with http:// or https://.")
  return u.toString()
}

export async function createHook(c: Ctx, envId: string, url: string) {
  const secret = `whsec_${randomBytes(24).toString("base64url")}`
  const [h] = await db
    .insert(secretWebhooks)
    .values({ envId, url: checkUrl(url), secretEnc: sealValue(c.key, c.projectId, secret) })
    .returning({ id: secretWebhooks.id })
  return { id: h.id, secret }
}

export async function listHooks(envId: string) {
  const hooks = await db.select().from(secretWebhooks).where(eq(secretWebhooks.envId, envId)).orderBy(secretWebhooks.createdAt)
  const ids = hooks.map((h) => h.id)
  const log = ids.length
    ? await db
        .select()
        .from(secretWebhookDeliveries)
        .where(inArray(secretWebhookDeliveries.webhookId, ids))
        .orderBy(desc(secretWebhookDeliveries.createdAt))
        .limit(30)
    : []
  return {
    hooks: hooks.map((h) => ({ id: h.id, url: h.url, enabled: h.enabled })),
    deliveries: log.map((d) => ({
      id: d.id,
      webhookId: d.webhookId,
      event: d.event,
      status: d.status,
      httpStatus: d.httpStatus,
      message: d.message,
      attempts: d.attempts,
      at: d.createdAt.toISOString(),
      keys: (JSON.parse(d.payload) as { keys: string[] }).keys,
    })),
  }
}

export async function updateHook(envId: string, hookId: string, v: { url?: string; enabled?: boolean }) {
  const [h] = await db
    .update(secretWebhooks)
    .set({ ...(v.url !== undefined && { url: checkUrl(v.url) }), ...(v.enabled !== undefined && { enabled: v.enabled }) })
    .where(and(eq(secretWebhooks.id, hookId), eq(secretWebhooks.envId, envId)))
    .returning({ id: secretWebhooks.id })
  if (!h) throw new SecretsError(404, "That webhook isn't here.")
}

export const deleteHook = (envId: string, hookId: string) =>
  db.delete(secretWebhooks).where(and(eq(secretWebhooks.id, hookId), eq(secretWebhooks.envId, envId)))

// Sends one delivery. Records the result; throws on failure so the queue tries again.
export async function deliver(deliveryId: string) {
  const [row] = await db
    .select({ d: secretWebhookDeliveries, h: secretWebhooks, e: secretEnvs })
    .from(secretWebhookDeliveries)
    .innerJoin(secretWebhooks, eq(secretWebhooks.id, secretWebhookDeliveries.webhookId))
    .innerJoin(secretEnvs, eq(secretEnvs.id, secretWebhooks.envId))
    .where(eq(secretWebhookDeliveries.id, deliveryId))
  if (!row || row.d.status === "delivered") return
  const c = await systemCtx(row.e.projectId)
  if (!c) return
  const secret = openValue(c.key, c.projectId, row.h.secretEnc)
  const attempts = row.d.attempts + 1
  let httpStatus: number | null = null
  let message = ""
  try {
    const res = await fetch(row.h.url, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "content-type": "application/json",
        "user-agent": "Nimbus-Secrets",
        "x-nimbus-event": row.d.event,
        "x-nimbus-delivery": row.d.id,
        "x-nimbus-signature": sign(secret, row.d.payload),
      },
      body: row.d.payload,
    })
    httpStatus = res.status
    if (!res.ok) message = `The receiver answered ${res.status}.`
  } catch (e) {
    message = (e as Error).name === "TimeoutError" ? "No answer in 10 seconds." : `Couldn't reach it: ${(e as Error).message}`
  }
  const ok = !message
  await db
    .update(secretWebhookDeliveries)
    .set({ attempts, httpStatus, message: message || null, status: ok ? "delivered" : "failed", ...(ok && { deliveredAt: new Date() }) })
    .where(eq(secretWebhookDeliveries.id, deliveryId))
  if (!ok) throw new Error(message)
}

// The Test button: one signed "test" delivery, sent now.
export async function testHook(envId: string, hookId: string) {
  const [h] = await db.select().from(secretWebhooks).where(and(eq(secretWebhooks.id, hookId), eq(secretWebhooks.envId, envId)))
  if (!h) throw new SecretsError(404, "That webhook isn't here.")
  const payload = await hookPayload(envId, "test", [])
  const [d] = await db
    .insert(secretWebhookDeliveries)
    .values({ webhookId: h.id, event: "test", payload: JSON.stringify(payload) })
    .returning({ id: secretWebhookDeliveries.id })
  await deliver(d.id).catch(() => {})
  const [r] = await db.select().from(secretWebhookDeliveries).where(eq(secretWebhookDeliveries.id, d.id))
  return { status: r.status, httpStatus: r.httpStatus, message: r.message }
}
