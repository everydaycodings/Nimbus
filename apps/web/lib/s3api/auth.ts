// S3 sign-in: an access key and a SigV4 signature. The key row says whose
// files, which buckets and read-only or not; every request is checked fresh.
import "server-only"

import { eq, sql } from "drizzle-orm"

import { decrypt } from "@/lib/crypto"
import { db } from "@/lib/db"
import { s3KeyBuckets, s3Keys, settings, user } from "@/lib/db/schema"
import { redis } from "@/lib/redis"

import { S3Error } from "./xml.ts"
import { parseAuthorization, parsePresigned, verifyHeaderAuth, verifyPresigned, type Checked, type Parsed, type Signed } from "./sigv4.ts"

const TRIES = 20
const WINDOW = 15 * 60

export type Who = {
  keyId: string
  userId: string
  write: boolean
  all: boolean
  bucketIds: Set<string>
  rps: number | null
}

const failKey = (ip: string | null) => `s3:fail:${ip ?? "unknown"}`

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

// Returns who is asking and what the signature chains chunked bodies from.
export async function s3SignIn(
  req: Signed,
  authorization: string | undefined,
  ip: string | null
): Promise<{ who: Who; checked: Checked }> {
  if ((await failures(ip)) >= TRIES)
    throw new S3Error("AccessDenied", "Too many failed requests from this address. Try again in 15 minutes.")
  // A presigned URL carries its signature in the query instead of a header.
  const pre = authorization ? null : parsePresigned(new URLSearchParams(req.url.split("?").slice(1).join("?")))
  if (!authorization && !pre) throw new S3Error("AccessDenied", "Anonymous access is not allowed. Sign the request with an access key.")
  const p: Parsed | null = pre ? pre.parsed : parseAuthorization(authorization!)
  if (!p) {
    await fail(ip)
    throw new S3Error("AuthorizationHeaderMalformed", "The authorization header is malformed.", 400)
  }
  const [row] = await db
    .select({
      id: s3Keys.id,
      userId: s3Keys.userId,
      secret: s3Keys.secretEnc,
      access: s3Keys.access,
      all: s3Keys.allBuckets,
      expiresAt: s3Keys.expiresAt,
      lastUsedAt: s3Keys.lastUsedAt,
      status: user.status,
      temp: user.passwordTemporary,
      disabled: user.s3Disabled,
      on: settings.s3Api,
      rps: settings.s3RpsLimit,
    })
    .from(s3Keys)
    .innerJoin(user, eq(user.id, s3Keys.userId))
    .innerJoin(settings, sql`true`)
    .where(eq(s3Keys.accessKeyId, p.accessKeyId))
  const secret = row && decrypt(row.secret)
  if (!row || !secret) {
    await fail(ip)
    throw new S3Error("InvalidAccessKeyId", "The access key ID you provided does not exist in our records.")
  }
  let checked: Checked
  try {
    checked = pre ? verifyPresigned(req, pre, secret) : verifyHeaderAuth(req, authorization!, secret)
  } catch (e) {
    await fail(ip)
    throw e
  }
  if (row.expiresAt && row.expiresAt.getTime() < Date.now())
    throw new S3Error("ExpiredToken", "This access key has expired.")
  if (!row.on) throw new S3Error("ServiceUnavailable", "The S3 API is turned off.", 503)
  if (row.status !== "active" || row.temp || row.disabled)
    throw new S3Error("AccessDenied", "This account can't use the S3 API.")
  // One write a minute is plenty for "last used".
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000)
    await db.update(s3Keys).set({ lastUsedAt: new Date(), lastIp: ip }).where(eq(s3Keys.id, row.id))
  const bucketIds = row.all
    ? []
    : (await db.select({ id: s3KeyBuckets.bucketId }).from(s3KeyBuckets).where(eq(s3KeyBuckets.keyId, row.id))).map((r) => r.id)
  return {
    checked,
    who: {
      keyId: row.id,
      userId: row.userId,
      write: row.access === "rw",
      all: row.all,
      bucketIds: new Set(bucketIds),
      rps: row.rps,
    },
  }
}

// At most `rps` requests per key per second (Admin → S3 API); the rest get SlowDown.
export async function rateLimit(who: Who) {
  if (!who.rps) return
  const k = `s3:rps:${who.keyId}:${Math.floor(Date.now() / 1000)}`
  try {
    const [[, n]] = (await redis.multi().incr(k).expire(k, 2).exec()) as [[null, number]]
    if (n > who.rps) throw new S3Error("SlowDown", "Please reduce your request rate.", 503)
  } catch (e) {
    if (e instanceof S3Error) throw e
  }
}
