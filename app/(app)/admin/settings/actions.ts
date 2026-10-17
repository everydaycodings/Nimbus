"use server"

import { randomBytes } from "node:crypto"
import { eq, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { db } from "@/lib/db"
import {
  SIGNUP_MODES,
  invites,
  settings,
  type SignupMode,
} from "@/lib/db/schema"
import { hasPassword, requireAdmin } from "@/lib/session"

const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/
const DAY = 24 * 60 * 60 * 1000

export async function setSignupMode(form: FormData) {
  await requireAdmin()
  const mode = form.get("mode") as SignupMode
  if (!SIGNUP_MODES.includes(mode)) return
  await db.update(settings).set({ signupMode: mode, updatedAt: new Date() })
  revalidatePath("/admin/settings")
}

// The admin turning it on must already use two-factor, so they don't lock themselves behind the setup screen.
export async function setRequire2fa(form: FormData) {
  const actor = await requireAdmin()
  const on = form.get("require2fa") === "on"
  if (on && !actor.twoFactorEnabled && (await hasPassword(actor.id))) return
  await db.update(settings).set({ require2fa: on, updatedAt: new Date() })
  revalidatePath("/", "layout")
}

const RETENTION = [7, 30, 90]

export async function setTrashRetention(form: FormData) {
  await requireAdmin()
  const days = Number(form.get("retention"))
  await db.update(settings).set({
    trashRetentionDays: RETENTION.includes(days) ? days : null,
    updatedAt: new Date(),
  })
  revalidatePath("/admin/settings")
}

export async function addTrustedDomain(form: FormData) {
  await requireAdmin()
  const domain = String(form.get("domain") ?? "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
  if (!DOMAIN.test(domain)) return
  await db
    .update(settings)
    .set({
      trustedDomains: sql`array_append(${settings.trustedDomains}, ${domain})`,
      updatedAt: new Date(),
    })
    .where(sql`not (${domain} = any(${settings.trustedDomains}))`)
  revalidatePath("/admin/settings")
}

export async function removeTrustedDomain(domain: string) {
  await requireAdmin()
  await db.update(settings).set({
    trustedDomains: sql`array_remove(${settings.trustedDomains}, ${domain})`,
    updatedAt: new Date(),
  })
  revalidatePath("/admin/settings")
}

export async function createInvite(form: FormData) {
  const actor = await requireAdmin()
  const days = Number(form.get("expires"))
  const maxUses = Number(form.get("maxUses"))
  await db.insert(invites).values({
    token: randomBytes(18).toString("base64url"),
    createdBy: actor.id,
    expiresAt: days > 0 ? new Date(Date.now() + days * DAY) : null,
    maxUses: Number.isInteger(maxUses) && maxUses > 0 ? maxUses : null,
  })
  revalidatePath("/admin/settings")
}

export async function revokeInvite(id: string) {
  await requireAdmin()
  await db.delete(invites).where(eq(invites.id, id))
  revalidatePath("/admin/settings")
}

// Blank means unlimited; anything else must be a positive whole number.
function limit(form: FormData, field: string) {
  const raw = String(form.get(field) ?? "").trim()
  const n = Number(raw)
  return raw && Number.isFinite(n) && n > 0 ? n : null
}

const UNITS: Record<string, number> = { MB: 2 ** 20, GB: 2 ** 30, TB: 2 ** 40 }

export async function setUploadLimit(form: FormData) {
  await requireAdmin()
  const n = limit(form, "maxSize")
  const unit = UNITS[String(form.get("unit"))] ?? UNITS.GB
  await db.update(settings).set({
    maxUploadBytes: n === null ? null : Math.round(n * unit),
    updatedAt: new Date(),
  })
  revalidatePath("/admin/settings")
}

export async function setDefaultQuota(form: FormData) {
  await requireAdmin()
  const n = limit(form, "quota")
  const unit = UNITS[String(form.get("unit"))] ?? UNITS.GB
  await db.update(settings).set({
    defaultQuotaBytes: n === null ? null : Math.round(n * unit),
    updatedAt: new Date(),
  })
  revalidatePath("/", "layout")
}

export async function addBlockedExtension(form: FormData) {
  await requireAdmin()
  const ext = String(form.get("ext") ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\*?\./, "")
  if (!/^[a-z0-9_-]{1,20}$/.test(ext)) return
  await db
    .update(settings)
    .set({
      blockedExtensions: sql`array_append(${settings.blockedExtensions}, ${ext})`,
      updatedAt: new Date(),
    })
    .where(sql`not (${ext} = any(${settings.blockedExtensions}))`)
  revalidatePath("/admin/settings")
}

export async function removeBlockedExtension(ext: string) {
  await requireAdmin()
  await db.update(settings).set({
    blockedExtensions: sql`array_remove(${settings.blockedExtensions}, ${ext})`,
    updatedAt: new Date(),
  })
  revalidatePath("/admin/settings")
}

export async function setVersionRetention(form: FormData) {
  await requireAdmin()
  const keep = limit(form, "keepLast")
  const days = limit(form, "maxAgeDays")
  await db.update(settings).set({
    versionKeepLast: keep && Math.floor(keep),
    versionMaxAgeDays: days && Math.floor(days),
    updatedAt: new Date(),
  })
  revalidatePath("/admin/settings")
}
