// Registry sign-in: HTTP Basic with an NMCR token as the password (the username is
// ignored). No credentials means anonymous, which can only pull public repos.
import "server-only"

import { timingSafeEqual } from "node:crypto"

import { eq, sql } from "drizzle-orm"

import { decrypt } from "@/lib/crypto"
import { db } from "@/lib/db"
import { user } from "@/lib/db/auth-schema"
import { registryTokenRepos, registryTokens, settings } from "@/lib/db/schema"
import { redis } from "@/lib/redis"

import type { Actor } from "./access.ts"
import { RegError, errors } from "./http.ts"
import { splitToken } from "./rules.ts"
import { credential } from "./wire.ts"

const TRIES = 20
const WINDOW = 15 * 60

const failKey = (ip: string | null) => `registry:fail:${ip ?? "unknown"}`

// Redis being down shouldn't lock everyone out, so failures there are ignored.
async function failures(ip: string | null) {
  try {
    return Number(await redis.get(failKey(ip))) || 0
  } catch {
    return 0
  }
}

async function fail(ip: string | null) {
  try {
    await redis.multi().incr(failKey(ip)).expire(failKey(ip), WINDOW).exec()
  } catch {}
}

export const ANONYMOUS: Actor = { userId: null, tokenId: null, access: "pull", allRepos: true, repoIds: [] }

export type SignedIn = { actor: Actor; name: string }

export async function signIn(authorization: string | null, ip: string | null): Promise<SignedIn> {
  const password = credential(authorization)
  if (!password) return { actor: ANONYMOUS, name: "Anonymous" }
  if ((await failures(ip)) >= TRIES)
    throw new RegError("TOOMANYREQUESTS", "Too many failed requests from this address. Try again in 15 minutes.", 429)
  const t = splitToken(password)
  const [row] = t
    ? await db
        .select({
          id: registryTokens.id,
          userId: registryTokens.userId,
          secret: registryTokens.secretEnc,
          access: registryTokens.access,
          all: registryTokens.allRepos,
          expiresAt: registryTokens.expiresAt,
          lastUsedAt: registryTokens.lastUsedAt,
          name: user.name,
          status: user.status,
          temp: user.passwordTemporary,
          disabled: user.registryDisabled,
          rps: settings.registryRpsLimit,
        })
        .from(registryTokens)
        .innerJoin(user, eq(user.id, registryTokens.userId))
        .innerJoin(settings, sql`true`)
        .where(eq(registryTokens.prefix, t.prefix))
    : []
  const secret = row && decrypt(row.secret)
  const a = Buffer.from(secret ?? "")
  const b = Buffer.from(t?.secret ?? "")
  if (!row || !secret || a.length !== b.length || !timingSafeEqual(a, b)) {
    await fail(ip)
    throw errors.unauthorized("Invalid token.")
  }
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) throw errors.unauthorized("This token has expired.")
  if (row.status !== "active" || row.temp || row.disabled) throw errors.denied("This account can't use the registry.")
  if (row.rps) {
    const k = `registry:rps:${row.id}:${Math.floor(Date.now() / 1000)}`
    try {
      const [[, n]] = (await redis.multi().incr(k).expire(k, 2).exec()) as [[null, number]]
      if (n > row.rps) throw new RegError("TOOMANYREQUESTS", "Please reduce your request rate.", 429, undefined, { "Retry-After": "1" })
    } catch (e) {
      if (e instanceof RegError) throw e
    }
  }
  // One write a minute is plenty for "last used".
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000)
    await db.update(registryTokens).set({ lastUsedAt: new Date(), lastIp: ip }).where(eq(registryTokens.id, row.id))
  const repoIds = row.all
    ? []
    : (await db.select({ id: registryTokenRepos.repoId }).from(registryTokenRepos).where(eq(registryTokenRepos.tokenId, row.id))).map((r) => r.id)
  return {
    name: row.name,
    actor: { userId: row.userId, tokenId: row.id, access: row.access, allRepos: row.all, repoIds },
  }
}
