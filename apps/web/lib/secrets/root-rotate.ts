// Root key rotation. SECRETS_ROOT_KEY seals each project's data key and every share
// link's text directly. To rotate: set the new key as SECRETS_ROOT_KEY and the old one as
// SECRETS_ROOT_KEY_PREVIOUS (reads work with either), run runRootRotation (the worker job
// secrets-rotate-root, started from Admin → System → Health), then drop the previous key.
// Values are sealed by the project key, so they aren't touched. Resumable: a row that
// opens with the new key is already done, so a second run only does what's left.
import "server-only"

import { and, eq, isNotNull } from "drizzle-orm"

import { auditAs } from "@/lib/audit"
import { db } from "@/lib/db"
import { secretProjects, secretRootKey, secretShares } from "@/lib/db/schema"
import { SHARE_AAD, fingerprint, kmsConfigured, needsRewrap, previousRootKey, projectAad, rewrap, rootKey } from "./kms"

// Everything sealed straight by the root key. Add a source here for any new column that is.
type Source = {
  name: string
  list: () => Promise<{ id: string; sealed: string; aad: string }[]>
  save: (id: string, was: string, now: string) => Promise<void>
}

export const SOURCES: Source[] = [
  {
    name: "project keys",
    list: async () => (await db.select({ id: secretProjects.id, s: secretProjects.wrappedKey }).from(secretProjects)).map((r) => ({ id: r.id, sealed: r.s, aad: projectAad(r.id) })),
    save: async (id, was, now) => void (await db.update(secretProjects).set({ wrappedKey: now }).where(and(eq(secretProjects.id, id), eq(secretProjects.wrappedKey, was)))),
  },
  {
    name: "share links",
    list: async () => (await db.select({ id: secretShares.id, s: secretShares.valueEnc }).from(secretShares).where(isNotNull(secretShares.valueEnc))).map((r) => ({ id: r.id, sealed: r.s!, aad: SHARE_AAD })),
    save: async (id, was, now) => void (await db.update(secretShares).set({ valueEnc: now }).where(and(eq(secretShares.id, id), eq(secretShares.valueEnc, was)))),
  },
]

async function pendingRows() {
  const out: { src: Source; id: string; sealed: string; aad: string }[] = []
  for (const src of SOURCES) for (const r of await src.list()) if (needsRewrap(r.sealed, r.aad)) out.push({ src, ...r })
  return out
}

// The status row: written the first time a key is seen, replaced when the key changes.
async function statusRow() {
  const fp = fingerprint(rootKey())
  const [row] = await db.select().from(secretRootKey).where(eq(secretRootKey.id, 1))
  if (!row) {
    const [r] = await db.insert(secretRootKey).values({ id: 1, fingerprint: fp }).onConflictDoNothing().returning()
    return r ?? (await db.select().from(secretRootKey).where(eq(secretRootKey.id, 1)))[0]
  }
  if (row.fingerprint === fp) return row
  const [r] = await db.update(secretRootKey).set({ fingerprint: fp, since: new Date() }).where(eq(secretRootKey.id, 1)).returning()
  return r
}

export async function rootKeyStatus() {
  if (!kmsConfigured()) return { configured: false as const }
  const row = await statusRow()
  const prev = previousRootKey()
  return {
    configured: true as const,
    now: Date.now(),
    fingerprint: row.fingerprint,
    since: row.since.toISOString(),
    previous: prev ? fingerprint(prev) : null,
    pending: prev ? (await pendingRows()).length : 0,
    running: row.running,
    total: row.total,
    done: row.done,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    error: row.error,
  }
}

const SAVE_EVERY = 10

export async function runRootRotation() {
  if (!kmsConfigured() || !previousRootKey()) return { done: 0 }
  await statusRow()
  const todo = await pendingRows()
  await db.update(secretRootKey).set({ running: true, total: todo.length, done: 0, startedAt: new Date(), finishedAt: null, error: null }).where(eq(secretRootKey.id, 1))
  let done = 0
  try {
    for (const r of todo) {
      await r.src.save(r.id, r.sealed, rewrap(r.sealed, r.aad))
      if (++done % SAVE_EVERY === 0) await db.update(secretRootKey).set({ done }).where(eq(secretRootKey.id, 1))
    }
  } catch (e) {
    await db.update(secretRootKey).set({ running: false, done, error: (e as Error).message.slice(0, 300) }).where(eq(secretRootKey.id, 1))
    throw e
  }
  await db.update(secretRootKey).set({ running: false, done, finishedAt: new Date() }).where(eq(secretRootKey.id, 1))
  await auditAs({ id: null, name: "Nimbus worker" }, "secrets_root_rewrap", `${done} value${done === 1 ? "" : "s"} sealed again under key ${fingerprint(rootKey())}`)
  return { done }
}
