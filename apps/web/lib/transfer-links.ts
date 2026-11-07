// The recipient's side of a transfer (/t/<token>): lookups, the password's
// unlock cookie, the visit cookie that decides what counts as a download, and
// the access log. The sender's side is lib/services/transfers.ts.
import "server-only"

import { and, asc, count, eq, gt, isNull, sql } from "drizzle-orm"
import { cookies, headers } from "next/headers"

import { db } from "@/lib/db"
import {
  settings,
  transferEvents,
  transferFiles,
  transferRecipients,
  transfers,
  user,
} from "@/lib/db/schema"
import { checkPassword, clientIp } from "@/lib/links"
import { notify } from "@/lib/notify"
import { readToken, signToken } from "@/lib/upload-rules"

export type Found = NonNullable<Awaited<ReturnType<typeof findTransfer>>>

// A transfer that is open to this recipient's link: finished, not revoked or
// expired, Transfer on, sender still active. `closed`: the download limit is used up.
export async function findTransfer(token: string) {
  if (!/^[\w-]{10,64}$/.test(token)) return null
  const [row] = await db
    .select({
      recipientId: transferRecipients.id,
      email: transferRecipients.email,
      id: transfers.id,
      senderId: transfers.senderId,
      senderName: user.name,
      senderEmail: user.email,
      title: transfers.title,
      message: transfers.message,
      expiresAt: transfers.expiresAt,
      passwordHash: transfers.passwordHash,
      downloadLimit: transfers.downloadLimit,
      downloads: transfers.downloads,
    })
    .from(transferRecipients)
    .innerJoin(transfers, eq(transfers.id, transferRecipients.transferId))
    .innerJoin(user, eq(user.id, transfers.senderId))
    .innerJoin(settings, sql`true`)
    .where(
      and(
        eq(transferRecipients.token, token),
        eq(settings.transfersEnabled, true),
        eq(transfers.draft, false),
        isNull(transfers.revokedAt),
        gt(transfers.expiresAt, sql`now()`),
        eq(user.status, "active")
      )
    )
  if (!row) return null
  return {
    ...row,
    closed: row.downloadLimit !== null && row.downloads >= row.downloadLimit,
  }
}

export const filesOf = (transferId: string) =>
  db
    .select()
    .from(transferFiles)
    .where(eq(transferFiles.transferId, transferId))
    .orderBy(asc(transferFiles.name))

const DAY = 24 * 60 * 60 * 1000
const secure = process.env.NODE_ENV === "production"
const unlockName = (id: string) => `nimbus_transfer_${id}`
const visitName = (recipientId: string) => `nimbus_tvisit_${recipientId}`
// Which password this is, so a changed password locks old cookies out.
const rev = (t: Found) => t.passwordHash?.slice(-12) ?? ""

export async function unlocked(t: Found) {
  if (!t.passwordHash) return true
  const c = readToken<{ s: string; r: string; exp: number }>(
    "transfer-unlock",
    (await cookies()).get(unlockName(t.id))?.value
  )
  return Boolean(c && c.s === t.id && c.r === rev(t) && c.exp > Date.now())
}

// ponytail: 10 wrong tries per IP per transfer per 15 minutes, counted from the log.
const TRIES = 10

export async function unlock(t: Found, pw: string) {
  const ip = await clientIp()
  const [{ n }] = await db
    .select({ n: count() })
    .from(transferEvents)
    .innerJoin(
      transferRecipients,
      eq(transferRecipients.id, transferEvents.recipientId)
    )
    .where(
      and(
        eq(transferRecipients.transferId, t.id),
        eq(transferEvents.kind, "unlock_fail"),
        ip ? eq(transferEvents.ip, ip) : isNull(transferEvents.ip),
        gt(transferEvents.at, sql`now() - interval '15 minutes'`)
      )
    )
  if (n >= TRIES)
    return { error: "Too many wrong tries. Wait 15 minutes and try again." }
  if (!t.passwordHash || !(await checkPassword(pw, t.passwordHash))) {
    await logEvent(t.recipientId, "unlock_fail")
    return { error: "That password isn't right." }
  }
  ;(await cookies()).set(
    unlockName(t.id),
    signToken("transfer-unlock", { s: t.id, r: rev(t) }, DAY),
    { httpOnly: true, sameSite: "lax", secure, maxAge: DAY / 1000, path: "/" }
  )
  return {}
}

// A transfer this visitor may use right now: unlocked, and either under the
// download limit or in a visit that already counted.
export async function openTransfer(token: string) {
  const t = await findTransfer(token)
  if (!t || !(await unlocked(t))) return null
  return t.closed && !(await inVisit(t)) ? null : t
}

// A visit is half an hour after a counted download: more files in it are free.
const VISIT = 30 * 60 * 1000

export async function inVisit(t: Found) {
  const c = readToken<{ s: string; exp: number }>(
    "transfer-visit",
    (await cookies()).get(visitName(t.recipientId))?.value
  )
  return Boolean(c && c.s === t.recipientId && c.exp > Date.now())
}

// Set-Cookie value that starts a visit, for a route's Response.
export const visitCookie = (t: Found) =>
  `${visitName(t.recipientId)}=${signToken("transfer-visit", { s: t.recipientId }, VISIT)}; Path=/; Max-Age=${VISIT / 1000}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`

export async function logEvent(
  recipientId: string,
  kind: "view" | "download" | "unlock_fail" | "save",
  detail?: string
) {
  const h = await headers()
  const ip = await clientIp()
  const ua = h.get("user-agent")?.slice(0, 300) ?? null
  // Refreshes aren't new visits: one view per visitor per half hour.
  if (kind === "view") {
    const [{ n }] = await db
      .select({ n: count() })
      .from(transferEvents)
      .where(
        and(
          eq(transferEvents.recipientId, recipientId),
          eq(transferEvents.kind, "view"),
          ip ? eq(transferEvents.ip, ip) : isNull(transferEvents.ip),
          ua ? eq(transferEvents.ua, ua) : isNull(transferEvents.ua),
          gt(transferEvents.at, sql`now() - interval '30 minutes'`)
        )
      )
    if (n) return
  }
  await db.insert(transferEvents).values({
    recipientId,
    kind,
    ip,
    ua,
    detail: detail?.slice(0, 500) ?? null,
  })
}

// Counts one full download, unless the limit is already used up (false then).
// The first download tells the sender; the log keeps every one.
export async function countDownload(t: Found, detail: string) {
  const [hit] = await db
    .update(transfers)
    .set({ downloads: sql`${transfers.downloads} + 1` })
    .where(
      and(
        eq(transfers.id, t.id),
        sql`(${transfers.downloadLimit} is null or ${transfers.downloads} < ${transfers.downloadLimit})`
      )
    )
    .returning({ id: transfers.id })
  if (!hit) return false
  await db
    .update(transferRecipients)
    .set({ downloads: sql`${transferRecipients.downloads} + 1`, lastAt: new Date() })
    .where(eq(transferRecipients.id, t.recipientId))
  await logEvent(t.recipientId, "download", detail)
  await notify(t.senderId, "transfer_download", {
    data: { who: t.email ?? "", title: t.title ?? "", transfer: t.id },
  })
  return true
}
