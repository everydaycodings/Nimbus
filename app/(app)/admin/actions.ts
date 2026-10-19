"use server"

import { randomBytes } from "node:crypto"
import { and, eq, ilike, isNotNull, or, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { db } from "@/lib/db"
import {
  SIGNUP_MODES,
  TOAST_POSITIONS,
  invites,
  settings,
  shares,
  user,
  type SignupMode,
  type ToastPosition,
} from "@/lib/db/schema"
import { POLICY_MAX, POLICY_MIN } from "@/lib/password-policy"
import { scheduleBackups, scheduleHealth } from "@/lib/redis"
import { hasPassword, requireAdmin } from "@/lib/session"
import { getSettings, settingDefault, type SettingKey } from "@/lib/signup"

const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/
const DAY = 24 * 60 * 60 * 1000

export async function setSignupMode(form: FormData) {
  await requireAdmin()
  const mode = form.get("mode") as SignupMode
  if (!SIGNUP_MODES.includes(mode)) return
  await db.update(settings).set({ signupMode: mode, updatedAt: new Date() })
  revalidatePath("/admin", "layout")
}

// The admin turning it on must already use two-factor, so they don't lock themselves behind the setup screen.
export async function setRequire2fa(form: FormData) {
  const actor = await requireAdmin()
  const on = form.get("require2fa") === "on"
  if (on && !actor.twoFactorEnabled && (await hasPassword(actor.id))) return
  await db.update(settings).set({ require2fa: on, updatedAt: new Date() })
  revalidatePath("/", "layout")
}

export async function setToastPosition(form: FormData) {
  await requireAdmin()
  const position = form.get("position") as ToastPosition
  if (!TOAST_POSITIONS.includes(position)) return
  await db
    .update(settings)
    .set({ toastPosition: position, updatedAt: new Date() })
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
  revalidatePath("/admin", "layout")
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
  revalidatePath("/admin", "layout")
}

export async function removeTrustedDomain(domain: string) {
  await requireAdmin()
  await db.update(settings).set({
    trustedDomains: sql`array_remove(${settings.trustedDomains}, ${domain})`,
    updatedAt: new Date(),
  })
  revalidatePath("/admin", "layout")
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
  revalidatePath("/admin", "layout")
}

export async function revokeInvite(id: string) {
  await requireAdmin()
  await db.delete(invites).where(eq(invites.id, id))
  revalidatePath("/admin", "layout")
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
  revalidatePath("/admin", "layout")
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
  revalidatePath("/admin", "layout")
}

export async function removeBlockedExtension(ext: string) {
  await requireAdmin()
  await db.update(settings).set({
    blockedExtensions: sql`array_remove(${settings.blockedExtensions}, ${ext})`,
    updatedAt: new Date(),
  })
  revalidatePath("/admin", "layout")
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
  revalidatePath("/admin", "layout")
}

// Blank turns Collabora off. Only http(s), without a trailing slash.
export async function setOfficeUrl(form: FormData) {
  await requireAdmin()
  const raw = String(form.get("officeUrl") ?? "")
    .trim()
    .replace(/\/+$/, "")
  let url: string | null = null
  if (raw) {
    try {
      const u = new URL(raw)
      if (u.protocol !== "http:" && u.protocol !== "https:") return
      url = u.origin + u.pathname.replace(/\/+$/, "")
    } catch {
      return
    }
  }
  await db.update(settings).set({ officeUrl: url, updatedAt: new Date() })
  revalidatePath("/admin", "layout")
}

// Tesseract language codes, e.g. "eng" or "eng+deu+chi_sim".
export async function setOcrLangs(form: FormData) {
  await requireAdmin()
  const langs = String(form.get("ocrLangs") ?? "")
    .toLowerCase()
    .split(/[\s,+]+/)
    .filter((l) => /^[a-z]{3}(_[a-z]+)?$/.test(l))
    .slice(0, 5)
  await db
    .update(settings)
    .set({ ocrLangs: langs.join("+") || "eng", updatedAt: new Date() })
  revalidatePath("/admin", "layout")
}

// Off stops new vaults; existing ones keep working for their owners.
export async function setVaultPolicy(form: FormData) {
  await requireAdmin()
  const cap = limit(form, "maxVaults")
  await db.update(settings).set({
    vaultsEnabled: form.get("enabled") === "on",
    maxVaultsPerMember: cap && Math.min(Math.ceil(cap), 1000),
    updatedAt: new Date(),
  })
  revalidatePath("/", "layout")
}

// Off: null, the industry-standard defaults. Applies to passwords chosen from now on.
export async function setPasswordPolicy(form: FormData) {
  await requireAdmin()
  const min = Math.floor(Number(form.get("min")))
  const passwordPolicy =
    form.get("custom") === "on"
      ? {
          min: Math.min(
            Math.max(Number.isFinite(min) ? min : POLICY_MIN, POLICY_MIN),
            POLICY_MAX
          ),
          lower: form.get("lower") === "on",
          upper: form.get("upper") === "on",
          digit: form.get("digit") === "on",
          symbol: form.get("symbol") === "on",
          exclude: [...new Set(String(form.get("exclude") ?? ""))]
            .join("")
            .slice(0, 64),
        }
      : null
  await db.update(settings).set({ passwordPolicy, updatedAt: new Date() })
  revalidatePath("/", "layout")
}

export async function setLinkPolicy(form: FormData) {
  await requireAdmin()
  const days = limit(form, "maxLinkDays")
  await db.update(settings).set({
    publicLinksEnabled: form.get("enabled") === "on",
    maxLinkDays: days && Math.min(Math.floor(days), 3650),
    requireLinkPassword: form.get("requirePassword") === "on",
    updatedAt: new Date(),
  })
  revalidatePath("/admin", "layout")
}

// Settings a "Reset to default" button may touch. Email has its own form.
const RESETTABLE: SettingKey[] = [
  "signupMode",
  "require2fa",
  "passwordPolicy",
  "defaultQuotaBytes",
  "maxUploadBytes",
  "blockedExtensions",
  "versionKeepLast",
  "versionMaxAgeDays",
  "trashRetentionDays",
  "publicLinksEnabled",
  "requireLinkPassword",
  "maxLinkDays",
  "vaultsEnabled",
  "maxVaultsPerMember",
  "officeUrl",
  "ocrLangs",
  "toastPosition",
  "healthIntervalMin",
  "healthFailures",
  "healthRetentionDays",
  "healthDisabled",
  "healthSlowMs",
  "backupDbIntervalH",
  "backupDbStart",
  "backupFilesIntervalH",
  "backupFilesStart",
  "backupTz",
  "backupRetention",
  "backupFilesGraceDays",
  "backupFilesEncrypt",
  "backupFilesConcurrency",
  "backupFilesSamplePct",
  "backupRetryAttempts",
  "backupRetryDelayMin",
  "backupShrinkWarnPct",
  "backupAlerts",
]

export async function resetSetting(keys: SettingKey[]) {
  await requireAdmin()
  const set = Object.fromEntries(
    keys
      .filter((k) => RESETTABLE.includes(k))
      .map((k) => [k, settingDefault(k)])
  )
  if (!Object.keys(set).length) return
  await db.update(settings).set({ ...set, updatedAt: new Date() })
  if ("healthIntervalMin" in set)
    await scheduleHealth(set.healthIntervalMin as number | null)
  if (keys.some((k) => /^backup(Db|Files)(IntervalH|Start)$|^backupTz$/.test(k)))
    await scheduleBackups(await getSettings()).catch(() => {})
  revalidatePath("/", "layout")
}

export async function revokeLink(id: string) {
  await requireAdmin()
  await db
    .delete(shares)
    .where(and(eq(shares.id, String(id)), isNotNull(shares.token)))
  revalidatePath("/admin", "layout")
}

// Admin search: people by name or email. The owner is listed but never acted on here.
export async function findMembers(q: string) {
  await requireAdmin()
  const like = `%${String(q)
    .trim()
    .replace(/[\\%_]/g, "\\$&")}%`
  return db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      status: user.status,
    })
    .from(user)
    .where(or(ilike(user.name, like), ilike(user.email, like)))
    .orderBy(user.name)
    .limit(5)
}
