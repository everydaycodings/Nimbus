// Public links (/s/<token>): lookups, passwords, the unlock cookie and the
// access log.
import "server-only"

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"

import { and, count, eq, gt, isNull, or, sql } from "drizzle-orm"
import { cookies, headers } from "next/headers"

import { db } from "@/lib/db"
import { linkEvents, nodes, settings, shares, user } from "@/lib/db/schema"
import { UUID } from "@/lib/file-rules"
import { readToken, signToken } from "@/lib/upload-rules"
import { isInside } from "@/lib/uploads"

const scryptAsync = promisify(scrypt) as (
  pw: string,
  salt: Buffer,
  len: number
) => Promise<Buffer>

export async function hashLinkPassword(pw: string) {
  const salt = randomBytes(16)
  const hash = await scryptAsync(pw, salt, 32)
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`
}

async function checkPassword(pw: string, stored: string) {
  const [, salt, hash] = stored.split("$")
  if (!salt || !hash) return false
  const got = await scryptAsync(pw, Buffer.from(salt, "base64url"), 32)
  const want = Buffer.from(hash, "base64url")
  return got.length === want.length && timingSafeEqual(got, want)
}

// 128 random bits: 22 base64url characters.
export const newLinkToken = () => randomBytes(16).toString("base64url")

export type Link = NonNullable<Awaited<ReturnType<typeof findLink>>>

// A link that works right now: public links on, not expired, item not trashed,
// owner still active.
export async function findLink(token: string) {
  if (!/^[\w-]{10,64}$/.test(token)) return null
  const [row] = await db
    .select({
      id: shares.id,
      nodeId: shares.nodeId,
      name: shares.name,
      passwordHash: shares.passwordHash,
      pwRev: shares.pwRev,
      allowView: shares.allowView,
      allowDownload: shares.allowDownload,
      allowUpload: shares.allowUpload,
      uploadCapBytes: shares.uploadCapBytes,
      expiresAt: shares.expiresAt,
      ownerId: nodes.ownerId,
      ownerName: user.name,
      kind: nodes.kind,
      itemName: nodes.name,
    })
    .from(shares)
    .innerJoin(nodes, eq(nodes.id, shares.nodeId))
    .innerJoin(user, eq(user.id, nodes.ownerId))
    .innerJoin(settings, sql`true`)
    .where(
      and(
        eq(shares.token, token),
        eq(settings.publicLinksEnabled, true),
        isNull(nodes.trashedAt),
        eq(user.status, "active"),
        or(isNull(shares.expiresAt), gt(shares.expiresAt, sql`now()`))
      )
    )
  return row ?? null
}

const cookieName = (id: string) => `nimbus_link_${id}`
const DAY = 24 * 60 * 60 * 1000

type Unlock = { s: string; r: number; exp: number }

// Links without a password are always open; the rest need the cookie that a
// right password sets, from the password's current revision.
export async function unlocked(link: Link) {
  if (!link.passwordHash) return true
  const t = readToken<Unlock>(
    "link-unlock",
    (await cookies()).get(cookieName(link.id))?.value
  )
  return Boolean(
    t && t.s === link.id && t.r === link.pwRev && t.exp > Date.now()
  )
}

// ponytail: 10 wrong tries per IP per link per 15 minutes, counted from the log.
const TRIES = 10

export async function unlock(link: Link, pw: string) {
  const ip = await clientIp()
  const [{ n }] = await db
    .select({ n: count() })
    .from(linkEvents)
    .where(
      and(
        eq(linkEvents.shareId, link.id),
        eq(linkEvents.kind, "unlock_fail"),
        ip ? eq(linkEvents.ip, ip) : isNull(linkEvents.ip),
        gt(linkEvents.at, sql`now() - interval '15 minutes'`)
      )
    )
  if (n >= TRIES)
    return { error: "Too many wrong tries. Wait 15 minutes and try again." }
  if (!link.passwordHash || !(await checkPassword(pw, link.passwordHash))) {
    await logLinkEvent(link.id, "unlock_fail")
    return { error: "That password isn't right." }
  }
  ;(await cookies()).set(
    cookieName(link.id),
    signToken("link-unlock", { s: link.id, r: link.pwRev }, DAY),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: DAY / 1000,
      path: "/",
    }
  )
  return {}
}

export async function clientIp() {
  const h = await headers()
  return (
    h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || null
  )
}

export async function logLinkEvent(
  shareId: string,
  kind: "view" | "download" | "upload" | "unlock_fail",
  detail?: string
) {
  const h = await headers()
  const ip = await clientIp()
  const ua = h.get("user-agent")?.slice(0, 300) ?? null
  // Page refreshes and folder clicks aren't new visits: one view per visitor
  // per half hour.
  if (kind === "view") {
    const [{ n }] = await db
      .select({ n: count() })
      .from(linkEvents)
      .where(
        and(
          eq(linkEvents.shareId, shareId),
          eq(linkEvents.kind, "view"),
          ip ? eq(linkEvents.ip, ip) : isNull(linkEvents.ip),
          ua ? eq(linkEvents.ua, ua) : isNull(linkEvents.ua),
          gt(linkEvents.at, sql`now() - interval '30 minutes'`)
        )
      )
    if (n) return
  }
  await db.insert(linkEvents).values({
    shareId,
    kind,
    ip,
    ua,
    detail: detail?.slice(0, 500) ?? null,
  })
  if (kind === "view" || kind === "download")
    await db
      .update(shares)
      .set(
        kind === "view"
          ? {
              viewCount: sql`${shares.viewCount} + 1`,
              lastOpenedAt: new Date(),
            }
          : { downloadCount: sql`${shares.downloadCount} + 1` }
      )
      .where(eq(shares.id, shareId))
}

// Recent drops from this IP across all links, to slow down anonymous floods.
// ponytail: 200 upload tokens per IP per hour, counted from the log.
export async function dropAllowed() {
  const ip = await clientIp()
  if (!ip) return true
  const [{ n }] = await db
    .select({ n: count() })
    .from(linkEvents)
    .where(
      and(
        eq(linkEvents.ip, ip),
        eq(linkEvents.kind, "upload"),
        gt(linkEvents.at, sql`now() - interval '1 hour'`)
      )
    )
  return n < 200
}

// A link that works and is unlocked for this visitor.
export async function openLink(token: string) {
  const link = await findLink(token)
  return link && (await unlocked(link)) ? link : null
}

// `id` if it's the link's item or inside it, untrashed.
export async function linkNode(link: Link, id: string) {
  if (!UUID.test(id)) return null
  if (id !== link.nodeId && !(await isInside(id, link.nodeId))) return null
  const [row] = await db
    .select({
      id: nodes.id,
      kind: nodes.kind,
      name: nodes.name,
      parentId: nodes.parentId,
      key: nodes.s3Key,
      mime: nodes.mime,
      version: nodes.currentVersionId,
    })
    .from(nodes)
    .where(
      and(
        eq(nodes.id, id),
        eq(nodes.ownerId, link.ownerId),
        isNull(nodes.trashedAt)
      )
    )
  return row ?? null
}
