// WebDAV sign-in: Basic auth with the account's email and an app password.
// App passwords are 30 random letters and digits in dash-separated groups of
// five; dashes, spaces and case don't matter when typed back.
import "server-only"

import { createHash, randomInt } from "node:crypto"

import { and, eq, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { appPasswords, settings, user } from "@/lib/db/schema"
import { redis } from "@/lib/redis"

export const APP_PASSWORD_DAYS = 90
const TRIES = 10
const WINDOW = 15 * 60

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"

export function newAppPassword() {
  let s = ""
  for (let i = 0; i < 30; i++) s += ALPHABET[randomInt(ALPHABET.length)]
  return s.match(/.{5}/g)!.join("-")
}

export const hashAppPassword = (raw: string) =>
  createHash("sha256")
    .update(raw.replace(/[\s-]/g, "").toLowerCase())
    .digest("hex")

export type DavUser = {
  id: string
  email: string
  name: string
  appId: string
  readOnly: boolean
}

const failKey = (ip: string | null) => `dav:fail:${ip ?? "unknown"}`

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

export async function davSignIn(
  header: string | null,
  ip: string | null
): Promise<DavUser | "blocked" | null> {
  if ((await failures(ip)) >= TRIES) return "blocked"
  const m = header?.match(/^Basic\s+(.+)$/i)
  if (!m) return null
  const plain = Buffer.from(m[1], "base64").toString("utf8")
  const at = plain.indexOf(":")
  if (at < 0) return null
  const email = plain.slice(0, at).trim().toLowerCase()
  const password = plain.slice(at + 1)

  const [row] = await db
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
      status: user.status,
      temp: user.passwordTemporary,
      disabled: user.webdavDisabled,
      on: settings.webdav,
      appId: appPasswords.id,
      scope: appPasswords.scope,
      lastUsedAt: appPasswords.lastUsedAt,
      createdAt: appPasswords.createdAt,
    })
    .from(appPasswords)
    .innerJoin(user, eq(user.id, appPasswords.userId))
    .innerJoin(settings, sql`true`)
    .where(
      and(
        eq(appPasswords.hash, hashAppPassword(password)),
        sql`lower(${user.email}) = ${email}`
      )
    )
  const fresh =
    row &&
    Date.now() - (row.lastUsedAt ?? row.createdAt).getTime() <
      APP_PASSWORD_DAYS * 86_400_000
  if (!row || !fresh || row.status !== "active" || row.temp || row.disabled || !row.on) {
    await fail(ip)
    return null
  }
  // One write a minute is plenty for "last used".
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000)
    await db
      .update(appPasswords)
      .set({ lastUsedAt: new Date(), lastIp: ip })
      .where(eq(appPasswords.id, row.appId))
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    appId: row.appId,
    readOnly: row.scope === "ro",
  }
}
