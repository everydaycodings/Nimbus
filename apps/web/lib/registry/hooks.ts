// Registry webhooks: a URL and secret on a namespace (or one repo), signed JSON POSTs for
// push / delete / scan, a delivery log, a Test button. The job queue retries failures.
// Signing and the address check are the Secrets ones (lib/secrets/webhooks.ts), so the same
// admin switch (Sharing → Secrets, "allow private addresses") applies here.
import "server-only"

import { randomBytes } from "node:crypto"

import { and, desc, eq, isNull, or } from "drizzle-orm"

import { decrypt, encrypt } from "@/lib/crypto"
import { db } from "@/lib/db"
import { registryHookDeliveries, registryHooks, registryNamespaces, registryRepos } from "@/lib/db/schema"
import { enqueue } from "@/lib/redis"
import { checkUrl, dialable, post, sign } from "@/lib/secrets/webhooks"

import { roleIn } from "./access.ts"

type Event = "push" | "delete" | "scan"
const EVENTS: Event[] = ["push", "delete", "scan"]

export class HookError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message)
  }
}

// Only the namespace's owner (their own, or an org's owner) manages its hooks.
async function owns(userId: string, namespaceId: string) {
  const [ns] = await db.select().from(registryNamespaces).where(eq(registryNamespaces.id, namespaceId))
  if (!ns || (await roleIn(userId, ns)) !== "owner") throw new HookError("Only the namespace owner can manage webhooks.", 403)
}

async function hookFor(userId: string, id: string) {
  const [h] = await db.select().from(registryHooks).where(eq(registryHooks.id, id))
  if (!h) throw new HookError("That webhook isn't here.", 404)
  await owns(userId, h.namespaceId)
  return h
}

async function checked(raw: string) {
  let u: URL
  try {
    u = checkUrl(raw)
  } catch (e) {
    throw new HookError((e as Error).message)
  }
  await dialable(u).catch((e: Error) => {
    throw new HookError(
      /private/.test(e.message) ? `${e.message} An admin can allow private addresses in Admin → Sharing → Secrets.` : e.message,
      422
    )
  })
  return u.toString()
}

export async function createHook(
  actorUserId: string,
  v: { namespaceId: string; repoId?: string | null; url: string; events: Event[] }
): Promise<{ id: string; secret: string }> {
  await owns(actorUserId, v.namespaceId)
  const events = EVENTS.filter((e) => v.events.includes(e))
  if (!events.length) throw new HookError("Pick at least one event.")
  if (v.repoId) {
    const [r] = await db
      .select({ id: registryRepos.id })
      .from(registryRepos)
      .where(and(eq(registryRepos.id, v.repoId), eq(registryRepos.namespaceId, v.namespaceId)))
    if (!r) throw new HookError("That repository isn't in this namespace.", 404)
  }
  const secret = `whsec_${randomBytes(24).toString("base64url")}`
  const [h] = await db
    .insert(registryHooks)
    .values({ namespaceId: v.namespaceId, repoId: v.repoId ?? null, url: await checked(v.url), secretEnc: encrypt(secret), events })
    .returning({ id: registryHooks.id })
  return { id: h.id, secret }
}

// The secret is never returned again.
export async function listHooks(namespaceId: string) {
  return db
    .select({
      id: registryHooks.id,
      repoId: registryHooks.repoId,
      url: registryHooks.url,
      events: registryHooks.events,
      enabled: registryHooks.enabled,
      createdAt: registryHooks.createdAt,
    })
    .from(registryHooks)
    .where(eq(registryHooks.namespaceId, namespaceId))
    .orderBy(registryHooks.createdAt)
}

export async function deleteHook(actorUserId: string, id: string) {
  await hookFor(actorUserId, id)
  await db.delete(registryHooks).where(eq(registryHooks.id, id))
}

export const listDeliveries = (hookId: string, limit = 20) =>
  db
    .select({
      id: registryHookDeliveries.id,
      event: registryHookDeliveries.event,
      status: registryHookDeliveries.status,
      error: registryHookDeliveries.error,
      attempts: registryHookDeliveries.attempts,
      deliveredAt: registryHookDeliveries.deliveredAt,
      createdAt: registryHookDeliveries.createdAt,
    })
    .from(registryHookDeliveries)
    .where(eq(registryHookDeliveries.hookId, hookId))
    .orderBy(desc(registryHookDeliveries.createdAt))
    .limit(limit)

// One send. Records the result; throws on failure so the queue tries again (8 times, backing off).
export async function deliver(deliveryId: string) {
  const [row] = await db
    .select({ d: registryHookDeliveries, h: registryHooks })
    .from(registryHookDeliveries)
    .innerJoin(registryHooks, eq(registryHooks.id, registryHookDeliveries.hookId))
    .where(eq(registryHookDeliveries.id, deliveryId))
  if (!row || row.d.deliveredAt) return
  const body = JSON.stringify(row.d.payload)
  let status: number | null = null
  let error = ""
  try {
    const u = new URL(row.h.url)
    status = await post(
      u,
      await dialable(u),
      {
        "content-type": "application/json",
        "user-agent": "Nimbus-Registry",
        "x-nimbus-event": row.d.event,
        "x-nimbus-delivery": row.d.id,
        "x-nimbus-signature": sign(decrypt(row.h.secretEnc) ?? "", body),
      },
      body
    )
    if (status < 200 || status > 299) error = `The receiver answered ${status}.`
  } catch (e) {
    const err = e as Error
    error = err.name === "TimeoutError" || err.name === "AbortError" ? "No answer in 10 seconds." : `Couldn't reach it: ${err.message}`
  }
  await db
    .update(registryHookDeliveries)
    .set({ attempts: row.d.attempts + 1, status, error: error || null, ...(!error && { deliveredAt: new Date() }) })
    .where(eq(registryHookDeliveries.id, deliveryId))
  if (error) throw new Error(error)
}

// The Test button: one signed "test" delivery, sent now (no retries).
export async function testHook(actorUserId: string, id: string) {
  const h = await hookFor(actorUserId, id)
  const [ns] = await db.select({ name: registryNamespaces.name }).from(registryNamespaces).where(eq(registryNamespaces.id, h.namespaceId))
  const [d] = await db
    .insert(registryHookDeliveries)
    .values({ hookId: h.id, event: "test", payload: { event: "test", repository: `${ns?.name}/example`, digest: `sha256:${"0".repeat(64)}`, mediaType: "application/vnd.oci.image.manifest.v1+json", at: new Date().toISOString() } })
    .returning({ id: registryHookDeliveries.id })
  await deliver(d.id).catch(() => {})
  const [r] = await db.select().from(registryHookDeliveries).where(eq(registryHookDeliveries.id, d.id))
  return { status: r.status, error: r.error }
}

// Called by the engine after the fact. Never throws: a webhook problem mustn't fail a push.
export async function emit(event: Event, repoId: string, payload: object) {
  try {
    const [repo] = await db.select({ namespaceId: registryRepos.namespaceId }).from(registryRepos).where(eq(registryRepos.id, repoId))
    if (!repo) return
    const hooks = await db
      .select({ id: registryHooks.id, events: registryHooks.events })
      .from(registryHooks)
      .where(
        and(
          eq(registryHooks.namespaceId, repo.namespaceId),
          eq(registryHooks.enabled, true),
          or(isNull(registryHooks.repoId), eq(registryHooks.repoId, repoId))
        )
      )
    const hit = hooks.filter((h) => h.events.includes(event))
    if (!hit.length) return
    const body = { event, ...payload, at: new Date().toISOString() }
    const rows = await db
      .insert(registryHookDeliveries)
      .values(hit.map((h) => ({ hookId: h.id, event, payload: body })))
      .returning({ id: registryHookDeliveries.id })
    for (const r of rows) await enqueue("registry-webhook", { id: r.id })
  } catch (e) {
    console.error("[registry] webhook emit:", e)
  }
}
