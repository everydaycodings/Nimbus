// Per-environment webhooks: a URL and a secret, a signed POST naming the changed keys
// (never values), a delivery log, a Test button. The queue retries failures.
import "server-only"

import { createHmac, randomBytes } from "node:crypto"
import http from "node:http"
import https from "node:https"

import { and, desc, eq, inArray } from "drizzle-orm"

import { db } from "@/lib/db"
import { secretEnvs, secretWebhookDeliveries, secretWebhooks, settings } from "@/lib/db/schema"
import { pinnedLookup } from "@/lib/push-rules"
import { checkAddress } from "./egress"
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
  if (u.username || u.password) throw new SecretsError(400, "Leave the login out of the URL.")
  return u
}

const allowPrivate = async () => Boolean((await db.select({ on: settings.secretAllowPrivate }).from(settings))[0]?.on)

// Where a delivery may go: public addresses unless an admin allows private ones (lib/secrets/egress.ts).
async function dialable(u: URL) {
  return checkAddress(u.hostname, Number(u.port) || (u.protocol === "https:" ? 443 : 80), await allowPrivate())
}

async function checkHookUrl(raw: string) {
  const u = checkUrl(raw)
  await dialable(u).catch((e: Error) => {
    throw new SecretsError(422, /private/.test(e.message) ? `${e.message} An admin can allow private addresses in Admin → Sharing → Secrets.` : e.message)
  })
  return u.toString()
}

// One POST to the checked address (no second DNS lookup), no redirects, the answer's body thrown away.
function post(u: URL, ip: string, headers: Record<string, string>, body: string) {
  return new Promise<number>((resolve, reject) => {
    const req = (u.protocol === "https:" ? https : http).request(
      u,
      { method: "POST", headers: { ...headers, "content-length": String(Buffer.byteLength(body)) }, lookup: pinnedLookup(ip) as never, signal: AbortSignal.timeout(10_000) },
      (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      }
    )
    req.on("error", reject)
    req.end(body)
  })
}

export async function createHook(c: Ctx, envId: string, url: string) {
  const secret = `whsec_${randomBytes(24).toString("base64url")}`
  const [h] = await db
    .insert(secretWebhooks)
    .values({ envId, url: await checkHookUrl(url), secretEnc: sealValue(c.key, c.projectId, secret) })
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
  const url = v.url !== undefined ? await checkHookUrl(v.url) : undefined
  const [h] = await db
    .update(secretWebhooks)
    .set({ ...(url !== undefined && { url }), ...(v.enabled !== undefined && { enabled: v.enabled }) })
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
    const u = new URL(row.h.url)
    httpStatus = await post(
      u,
      await dialable(u),
      {
        "content-type": "application/json",
        "user-agent": "Nimbus-Secrets",
        "x-nimbus-event": row.d.event,
        "x-nimbus-delivery": row.d.id,
        "x-nimbus-signature": sign(secret, row.d.payload),
      },
      row.d.payload
    )
    if (httpStatus < 200 || httpStatus > 299) message = `The receiver answered ${httpStatus}.`
  } catch (e) {
    const err = e as Error
    message = err.name === "TimeoutError" || err.name === "AbortError" ? "No answer in 10 seconds." : `Couldn't reach it: ${err.message}`
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
