// Machine tokens (nms_), CLI sign-ins (nmu_) and the device-code login behind them.
// Only sha256 hashes are stored; a token is shown once. Modeled on lib/device-link.ts
// and lib/dav/auth.ts.
import "server-only"

import { randomBytes } from "node:crypto"

import { and, desc, eq, gt, isNull, lt } from "drizzle-orm"

import { overLimit } from "@/lib/cache"
import { db } from "@/lib/db"
import {
  secretCliTokens,
  secretDeviceCodes,
  secretEnvs,
  secretProjects,
  secretTokens,
  secretUnlocks,
  secretSettings,
  settings,
  user,
} from "@/lib/db/schema"
import { KMS_SCOPES } from "./kms-core"
import { formatCode, hashSecret, newCode, normalizeCode } from "@/lib/device-link-rules"
import {
  CLI_PREFIX,
  MACHINE_PREFIX,
  hashToken,
  ipAllowed,
  newToken,
  normPath,
  validIpEntry,
} from "./token-rules"

export const DEVICE_TTL_S = 120

export type Principal =
  | {
      type: "machine"
      tokenId: string
      name: string
      projectId: string
      envIds: string[]
      path: string
      access: "ro" | "rw"
      createdBy: string | null
      ip: string | null
    }
  | { type: "user"; tokenId: string; userId: string; name: string; email: string; ip: string | null }

export class TokenError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra: Record<string, unknown> = {}
  ) {
    super(message)
  }
}

export function clientIp(req: Request) {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    null
  )
}

export async function tokenPolicy() {
  const [row] = await db
    .select({ tokens: settings.secretTokensEnabled, cli: settings.secretCliEnabled })
    .from(settings)
  return row ?? { tokens: true, cli: true }
}

// Rate limit for the token endpoints: per IP, so a guessed token costs the guesser.
export async function limitTokenIp(req: Request, bucket: string, perMinute: number) {
  if (await overLimit(`rl:secrets:${bucket}:${clientIp(req) ?? "?"}`, perMinute, 60))
    throw new TokenError(429, "rate_limited", "Too many requests. Try again in a minute.")
}

// Whether this member has a live Secrets unlock on any session. Unlike the browser's
// calls it doesn't slide the idle clock, so a polling agent can't keep the lock open.
export async function userUnlocked(userId: string) {
  const [p] = await db
    .select({ m: secretSettings.lockMinutes })
    .from(secretSettings)
    .where(eq(secretSettings.userId, userId))
  const minutes = p?.m ?? 15
  const [row] = await db
    .select({ id: secretUnlocks.sessionId })
    .from(secretUnlocks)
    .where(
      and(
        eq(secretUnlocks.userId, userId),
        gt(secretUnlocks.lastActiveAt, new Date(Date.now() - minutes * 60_000)),
        gt(secretUnlocks.unlockedAt, new Date(Date.now() - 12 * 3600_000))
      )
    )
    .limit(1)
  return Boolean(row)
}

// The bearer token on a request, checked: known, live, allowed from this IP and by
// policy. Failed guesses are rate limited per IP; every caller is rate limited per token.
export async function authenticate(req: Request): Promise<Principal> {
  const ip = clientIp(req)
  const raw = req.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1]
  const unauthorized = async (message: string) => {
    await limitTokenIp(req, "badtoken", 30)
    return new TokenError(401, "unauthorized", message)
  }
  if (!raw || !(raw.startsWith(MACHINE_PREFIX) || raw.startsWith(CLI_PREFIX)))
    throw await unauthorized("Missing or unknown token.")
  const hash = hashToken(raw)
  const pol = await tokenPolicy()
  const now = new Date()

  if (raw.startsWith(MACHINE_PREFIX)) {
    const [t] = await db.select().from(secretTokens).where(eq(secretTokens.hash, hash))
    if (!t || t.revokedAt || (t.expiresAt && t.expiresAt < now))
      throw await unauthorized("That token is invalid, expired or revoked.")
    if (!pol.tokens) throw new TokenError(403, "forbidden", "An admin turned machine tokens off.")
    if (!ipAllowed(t.ipAllow, ip))
      throw new TokenError(403, "forbidden", "This token can't be used from this IP address.")
    await limitTokenIp(req, `t:${t.id}`, 600)
    await db
      .update(secretTokens)
      .set({ lastUsedAt: now, lastIp: ip })
      .where(eq(secretTokens.id, t.id))
    return {
      type: "machine",
      tokenId: t.id,
      name: t.name,
      projectId: t.projectId,
      envIds: t.envIds,
      path: t.path,
      access: t.access,
      createdBy: t.createdBy,
      ip,
    }
  }

  const [t] = await db
    .select({ t: secretCliTokens, u: user })
    .from(secretCliTokens)
    .innerJoin(user, eq(user.id, secretCliTokens.userId))
    .where(eq(secretCliTokens.hash, hash))
  if (!t || t.t.revokedAt || t.u.status !== "active")
    throw await unauthorized("That token is invalid or revoked.")
  if (!pol.cli) throw new TokenError(403, "forbidden", "An admin turned the CLI off.")
  await limitTokenIp(req, `t:${t.t.id}`, 600)
  await db
    .update(secretCliTokens)
    .set({ lastUsedAt: now, lastIp: ip })
    .where(eq(secretCliTokens.id, t.t.id))
  return { type: "user", tokenId: t.t.id, userId: t.u.id, name: t.u.name, email: t.u.email, ip }
}

export async function revokeBearer(p: Principal) {
  const now = new Date()
  if (p.type === "machine")
    await db.update(secretTokens).set({ revokedAt: now }).where(eq(secretTokens.id, p.tokenId))
  else await db.update(secretCliTokens).set({ revokedAt: now }).where(eq(secretCliTokens.id, p.tokenId))
}

// ---- Machine tokens ---------------------------------------------------------

export type TokenInput = {
  name: string
  envIds: string[]
  path: string
  access: "ro" | "rw"
  expiresInDays: number | null
  ipAllow: string[]
  scopes?: string[]
}

export async function createMachineToken(projectId: string, userId: string, i: TokenInput) {
  const name = i.name.trim().slice(0, 60)
  if (!name) throw new TokenError(400, "bad_request", "Give the token a name.")
  const envs = await db.select({ id: secretEnvs.id }).from(secretEnvs).where(eq(secretEnvs.projectId, projectId))
  const ids = i.envIds.filter((e) => envs.some((x) => x.id === e))
  if (!ids.length) throw new TokenError(400, "bad_request", "Pick at least one environment.")
  const ips = i.ipAllow.map((e) => e.trim()).filter(Boolean)
  const badIp = ips.find((e) => !validIpEntry(e))
  if (badIp) throw new TokenError(400, "bad_request", `“${badIp}” isn't an IP address or CIDR range.`)
  if ((await tokenPolicy()).tokens === false)
    throw new TokenError(403, "forbidden", "An admin turned machine tokens off.")
  const token = newToken(MACHINE_PREFIX)
  const [row] = await db
    .insert(secretTokens)
    .values({
      projectId,
      name,
      hash: hashToken(token),
      prefix: token.slice(0, 8),
      envIds: ids,
      path: normPath(i.path),
      access: i.access,
      expiresAt: i.expiresInDays ? new Date(Date.now() + i.expiresInDays * 86400_000) : null,
      ipAllow: ips.length ? ips : null,
      scopes: (i.scopes ?? []).filter((x) => KMS_SCOPES.includes(x as (typeof KMS_SCOPES)[number])),
      createdBy: userId,
    })
    .returning({ id: secretTokens.id })
  return { id: row.id, token }
}

export async function listMachineTokens(projectId: string) {
  const rows = await db
    .select({
      t: secretTokens,
      by: user.name,
    })
    .from(secretTokens)
    .leftJoin(user, eq(user.id, secretTokens.createdBy))
    .where(eq(secretTokens.projectId, projectId))
    .orderBy(desc(secretTokens.createdAt))
  return rows.map(({ t, by }) => ({
    id: t.id,
    name: t.name,
    prefix: t.prefix,
    envIds: t.envIds,
    path: t.path,
    access: t.access,
    expiresAt: t.expiresAt?.toISOString() ?? null,
    ipAllow: t.ipAllow ?? [],
    scopes: t.scopes,
    createdBy: by,
    createdAt: t.createdAt.toISOString(),
    lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
    lastIp: t.lastIp,
    revoked: Boolean(t.revokedAt),
  }))
}

export async function revokeMachineToken(projectId: string, id: string) {
  const [r] = await db
    .update(secretTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(secretTokens.id, id), eq(secretTokens.projectId, projectId), isNull(secretTokens.revokedAt)))
    .returning({ name: secretTokens.name })
  return r?.name ?? null
}

// ---- Device login -----------------------------------------------------------

export async function startDevice(deviceName: string, ip: string | null) {
  await db.delete(secretDeviceCodes).where(lt(secretDeviceCodes.expiresAt, new Date(Date.now() - 3600_000)))
  const code = newCode()
  const pollToken = randomBytes(32).toString("base64url")
  await db.insert(secretDeviceCodes).values({
    codeHash: hashSecret(code),
    pollHash: hashSecret(pollToken),
    deviceName: deviceName.trim().slice(0, 80) || "Command line",
    ip: ip?.replace(/^::ffff:/, "") ?? null,
    expiresAt: new Date(Date.now() + DEVICE_TTL_S * 1000),
  })
  return { userCode: formatCode(code), pollToken }
}

const byCode = (raw: string) => {
  const code = normalizeCode(raw)
  return code ? eq(secretDeviceCodes.codeHash, hashSecret(code)) : null
}

export async function lookupDevice(raw: string) {
  const m = byCode(raw)
  if (!m) return null
  const [r] = await db
    .select({
      deviceName: secretDeviceCodes.deviceName,
      ip: secretDeviceCodes.ip,
      status: secretDeviceCodes.status,
      expiresAt: secretDeviceCodes.expiresAt,
    })
    .from(secretDeviceCodes)
    .where(m)
  if (!r) return null
  const expired = r.expiresAt < new Date() && r.status === "pending"
  return { deviceName: r.deviceName, ip: r.ip, status: expired ? "expired" : r.status }
}

export async function answerDevice(userId: string, raw: string, allow: boolean) {
  const m = byCode(raw)
  if (!m) return false
  const [r] = await db
    .update(secretDeviceCodes)
    .set({ status: allow ? "approved" : "denied", userId })
    .where(and(m, eq(secretDeviceCodes.status, "pending"), gt(secretDeviceCodes.expiresAt, new Date())))
    .returning({ id: secretDeviceCodes.id })
  return Boolean(r)
}

// pending | denied | expired, or the token once (it's made here, at collection).
export async function pollDevice(pollToken: string) {
  const hash = hashSecret(pollToken)
  const [r] = await db.select().from(secretDeviceCodes).where(eq(secretDeviceCodes.pollHash, hash))
  if (!r || r.status === "used") return { state: "expired" as const }
  if (r.status === "denied") return { state: "denied" as const }
  if (r.status === "pending")
    return r.expiresAt < new Date() ? { state: "expired" as const } : { state: "pending" as const }
  // Approved: collected exactly once, by the update that flips it to used.
  const [won] = await db
    .update(secretDeviceCodes)
    .set({ status: "used" })
    .where(and(eq(secretDeviceCodes.id, r.id), eq(secretDeviceCodes.status, "approved")))
    .returning({ userId: secretDeviceCodes.userId })
  if (!won?.userId) return { state: "expired" as const }
  const token = newToken(CLI_PREFIX)
  await db
    .insert(secretCliTokens)
    .values({ userId: won.userId, name: r.deviceName, hash: hashToken(token) })
  const [u] = await db.select({ email: user.email, name: user.name }).from(user).where(eq(user.id, won.userId))
  return { state: "ok" as const, token, user: u }
}

export async function listCliTokens(userId: string) {
  const rows = await db
    .select()
    .from(secretCliTokens)
    .where(and(eq(secretCliTokens.userId, userId), isNull(secretCliTokens.revokedAt)))
    .orderBy(desc(secretCliTokens.createdAt))
  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    createdAt: t.createdAt.toISOString(),
    lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
    lastIp: t.lastIp,
  }))
}

export async function revokeCliToken(userId: string, id: string) {
  const [r] = await db
    .update(secretCliTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(secretCliTokens.id, id), eq(secretCliTokens.userId, userId), isNull(secretCliTokens.revokedAt)))
    .returning({ name: secretCliTokens.name })
  return r?.name ?? null
}

export async function projectSlug(projectId: string) {
  const [p] = await db.select({ s: secretProjects.slug }).from(secretProjects).where(eq(secretProjects.id, projectId))
  return p?.s ?? ""
}
