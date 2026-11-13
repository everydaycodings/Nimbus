"use server"

import { randomBytes } from "node:crypto"
import { and, count, eq, ilike, isNotNull, isNull, or, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { MAX_SESSIONS } from "@/lib/accounts"
import { ACTIVITY_RETENTION } from "@/lib/activity-rules"
import { mlApi } from "@/lib/ai"
import { audit, saveSettings } from "@/lib/audit"
import { reloadAuth } from "@/lib/auth"
import { db } from "@/lib/db"
import {
  SIGNUP_MODES,
  TOAST_POSITIONS,
  invites,
  nodeContent,
  nodeTextParts,
  passkey,
  settings,
  shares,
  transfers,
  user,
  type SignupMode,
  type ToastPosition,
} from "@/lib/db/schema"
import { passkeyHost } from "@/lib/passkey-rules"
import { POLICY_MAX, POLICY_MIN } from "@/lib/password-policy"
import { turnCopiesOffAndDelete } from "@/lib/video-copies"
import { enqueue, scheduleBackups, scheduleHealth } from "@/lib/redis"
import { hasPassword, requireAdmin } from "@/lib/session"
import { getSettings, settingDefault, type SettingKey } from "@/lib/signup"

const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/
const DAY = 24 * 60 * 60 * 1000

export async function setSignupMode(form: FormData) {
  await requireAdmin()
  const mode = form.get("mode") as SignupMode
  if (!SIGNUP_MODES.includes(mode)) return
  await saveSettings({ signupMode: mode, updatedAt: new Date() })
  revalidatePath("/admin", "layout")
}

// The admin turning it on must already use two-factor, so they don't lock themselves behind the setup screen.
export async function setRequire2fa(form: FormData) {
  const actor = await requireAdmin()
  const on = form.get("require2fa") === "on"
  if (on && !actor.twoFactorEnabled && (await hasPassword(actor.id))) return
  await saveSettings({ require2fa: on, updatedAt: new Date() })
  revalidatePath("/", "layout")
}

// Passkeys on or off, and whether everyone must have one. Auth is rebuilt, since
// the passkey plugin is only added while they're on. The admin turning the rule
// on must already have a passkey, so they don't lock themselves behind the setup screen.
export async function setPasskeys(form: FormData) {
  const actor = await requireAdmin()
  const enabled = form.get("passkeysEnabled") === "on"
  const required = enabled && form.get("requirePasskey") === "on"
  if (required) {
    const [{ n }] = await db
      .select({ n: count() })
      .from(passkey)
      .where(eq(passkey.userId, actor.id))
    if (!n || !passkeyHost(process.env.BETTER_AUTH_URL)) return
  }
  await saveSettings({
    passkeysEnabled: enabled,
    requirePasskey: required,
    updatedAt: new Date(),
  })
  reloadAuth()
  revalidatePath("/", "layout")
}

// Whether OIDC sign-in skips Nimbus two-factor, because the provider asks for its own.
export async function setOidcTrustMfa(form: FormData) {
  await requireAdmin()
  await saveSettings({
    oidcTrustMfa: form.get("oidcTrustMfa") === "on",
    updatedAt: new Date(),
  })
  revalidatePath("/admin", "layout")
}

// Several accounts on one browser (the account menu's switcher).
export async function setMultiAccount(form: FormData) {
  await requireAdmin()
  const max = Math.round(Number(form.get("maxAccounts")))
  await saveSettings({
    multiAccount: form.get("multiAccount") === "on",
    maxAccounts: max >= 2 && max <= MAX_SESSIONS ? max : 5,
    updatedAt: new Date(),
  })
  revalidatePath("/", "layout")
}

// One-tap saved logins. Turning either switch off makes existing ones stop working.
export async function setSavedLogins(form: FormData) {
  await requireAdmin()
  await saveSettings({
    savedLogins: form.get("savedLogins") === "on",
    savedLoginsAdmins: form.get("savedLoginsAdmins") === "on",
    updatedAt: new Date(),
  })
  revalidatePath("/", "layout")
}

// QR and short-code sign-in for phones, from Account.
export async function setDeviceLinks(form: FormData) {
  await requireAdmin()
  await saveSettings({
    deviceLinks: form.get("deviceLinks") === "on",
    updatedAt: new Date(),
  })
  revalidatePath("/", "layout")
}

// Off makes every app password stop working; they come back when it's on.
export async function setWebdav(form: FormData) {
  await requireAdmin()
  await saveSettings({
    webdav: form.get("webdav") === "on",
    updatedAt: new Date(),
  })
  revalidatePath("/", "layout")
}

export async function setToastPosition(form: FormData) {
  await requireAdmin()
  const position = form.get("position") as ToastPosition
  if (!TOAST_POSITIONS.includes(position)) return
  await saveSettings({ toastPosition: position, updatedAt: new Date() })
  revalidatePath("/", "layout")
}

const RETENTION = [7, 30, 90]

export async function setTrashRetention(form: FormData) {
  await requireAdmin()
  const days = Number(form.get("retention"))
  await saveSettings({
    trashRetentionDays: RETENTION.includes(days) ? days : null,
    updatedAt: new Date(),
  })
  revalidatePath("/admin", "layout")
}

export async function setActivityRetention(form: FormData) {
  await requireAdmin()
  const days = Number(form.get("retention"))
  await saveSettings({
    activityRetentionDays: ACTIVITY_RETENTION.some((d) => d === days) ? days : null,
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
  await saveSettings({
    // Removed first, so adding one that's there already changes nothing.
    trustedDomains: sql`array_append(array_remove(${settings.trustedDomains}, ${domain}), ${domain})`,
    updatedAt: new Date(),
  })
  revalidatePath("/admin", "layout")
}

export async function removeTrustedDomain(domain: string) {
  await requireAdmin()
  await saveSettings({
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
  await audit("invite_create")
  revalidatePath("/admin", "layout")
}

export async function revokeInvite(id: string) {
  await requireAdmin()
  const gone = await db
    .delete(invites)
    .where(eq(invites.id, id))
    .returning({ id: invites.id })
  if (gone.length) await audit("invite_revoke")
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
  await saveSettings({
    maxUploadBytes: n === null ? null : Math.round(n * unit),
    updatedAt: new Date(),
  })
  revalidatePath("/admin", "layout")
}

// Required: the PDF editor always has a cap (100 MB until changed). Needs settings.maxPdfEditBytes, a bigint with that default.
export async function setPdfEditLimit(form: FormData) {
  await requireAdmin()
  const n = limit(form, "pdfMax")
  if (n === null) return
  const unit = UNITS[String(form.get("unit"))] ?? UNITS.MB
  await saveSettings({
    maxPdfEditBytes: Math.round(n * unit),
    updatedAt: new Date(),
  })
  revalidatePath("/admin", "layout")
}

export async function setUploadSpeed(form: FormData) {
  await requireAdmin()
  const n = limit(form, "speed")
  const unit = String(form.get("unit")) === "KB" ? 2 ** 10 : 2 ** 20
  await saveSettings({
    uploadSpeedBytes: n === null ? null : Math.max(1024, Math.round(n * unit)),
    updatedAt: new Date(),
  })
  revalidatePath("/", "layout")
}

export async function setDefaultQuota(form: FormData) {
  await requireAdmin()
  const n = limit(form, "quota")
  const unit = UNITS[String(form.get("unit"))] ?? UNITS.GB
  await saveSettings({
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
  await saveSettings({
    // Removed first, so adding one that's there already changes nothing.
    blockedExtensions: sql`array_append(array_remove(${settings.blockedExtensions}, ${ext}), ${ext})`,
    updatedAt: new Date(),
  })
  revalidatePath("/admin", "layout")
}

export async function removeBlockedExtension(ext: string) {
  await requireAdmin()
  await saveSettings({
    blockedExtensions: sql`array_remove(${settings.blockedExtensions}, ${ext})`,
    updatedAt: new Date(),
  })
  revalidatePath("/admin", "layout")
}

export async function setVersionRetention(form: FormData) {
  await requireAdmin()
  const keep = limit(form, "keepLast")
  const days = limit(form, "maxAgeDays")
  await saveSettings({
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
  await saveSettings({ officeUrl: url, updatedAt: new Date() })
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
  const chosen = langs.length ? langs : ["eng"]
  // Statuses start over; the worker downloads each language and writes them back.
  await saveSettings({
    ocrLangs: chosen.join("+"),
    ocrLangStatus: {},
    updatedAt: new Date(),
  })
  await enqueue("ocr-langs", { langs: chosen })
  revalidatePath("/admin", "layout")
}

const OCR_MODES = ["off", "images", "images_pdfs", "all"] as const

// What the worker reads text from: nothing, images, images and PDFs, or those and videos.
export async function setOcrMode(form: FormData) {
  await requireAdmin()
  const mode = OCR_MODES.find((m) => m === form.get("ocrMode"))
  if (!mode) return
  await saveSettings({ ocrMode: mode, updatedAt: new Date() })
  revalidatePath("/admin", "layout")
}

// How many minutes from the start of a video are read.
export async function setOcrVideoMax(form: FormData) {
  await requireAdmin()
  const n = limit(form, "videoMax")
  if (n === null) return
  await saveSettings({
    ocrVideoMaxMin: Math.min(Math.ceil(n), 1440),
    updatedAt: new Date(),
  })
  revalidatePath("/admin", "layout")
}

// Forgets every file's text; the worker reads them all again, a few a minute.
export async function rereadAll() {
  await requireAdmin()
  await db.delete(nodeTextParts)
  await db.delete(nodeContent)
  await audit("settings", { detail: "ocr: read all files' text again" })
  revalidatePath("/admin", "layout")
}

// ---- AI features (Phase 20): the nimbus-ml service ----

const WHISPER_MODELS = ["tiny", "base", "small", "medium"]
const CLIP_MODELS = ["vitb32", "multilingual"]

// Tells the service to download the model; it reports progress on /health.
async function pullModel(feature: "speech" | "clip" | "faces", model: string) {
  await mlApi(await getSettings())
    .pull(feature, model)
    .catch(() => {})
}

// Blank uses the ML_URL the server was started with (http://ml:8000 in the compose file).
export async function setMlConnection(form: FormData) {
  await requireAdmin()
  const raw = String(form.get("mlUrl") ?? "").trim().replace(/\/+$/, "")
  let url = ""
  if (raw) {
    try {
      const u = new URL(raw)
      if (u.protocol !== "http:" && u.protocol !== "https:") return
      url = u.origin + u.pathname.replace(/\/+$/, "")
    } catch {
      return
    }
  }
  await saveSettings({ mlUrl: url, updatedAt: new Date() })
  revalidatePath("/admin", "layout")
}

export async function setAiAccess(form: FormData) {
  await requireAdmin()
  const access = form.get("aiAccess") === "chosen" ? "chosen" : "everyone"
  await saveSettings({ aiAccess: access, updatedAt: new Date() })
  revalidatePath("/", "layout")
}

export async function setMlSpeech(form: FormData) {
  await requireAdmin()
  const model = WHISPER_MODELS.find((m) => m === form.get("whisperModel"))
  if (!model) return
  const enabled = form.get("enabled") === "on"
  await saveSettings({ mlSpeech: enabled, whisperModel: model, updatedAt: new Date() })
  if (enabled) await pullModel("speech", model)
  revalidatePath("/", "layout")
}

export async function setMlClip(form: FormData) {
  await requireAdmin()
  const model = CLIP_MODELS.find((m) => m === form.get("clipModel"))
  if (!model) return
  const enabled = form.get("enabled") === "on"
  await saveSettings({ mlClip: enabled, clipModel: model, updatedAt: new Date() })
  if (enabled) await pullModel("clip", model)
  revalidatePath("/", "layout")
}

// `facesDefault` "on": members get face grouping until they turn it off; "off": they opt in.
export async function setMlFaces(form: FormData) {
  await requireAdmin()
  const enabled = form.get("enabled") === "on"
  await saveSettings({ mlFaces: enabled, facesDefault: form.get("facesDefault") === "on", updatedAt: new Date() })
  if (enabled) await pullModel("faces", "default")
  revalidatePath("/", "layout")
}

// Forgets what a feature found; the worker does it all again, a few files a minute.
export async function reindexSpeech() {
  await requireAdmin()
  await db.execute(sql`delete from node_text_parts where source = 'speech'`)
  await db.execute(sql`delete from node_speech`)
  await audit("settings", { detail: "ai: transcribe all files again" })
  revalidatePath("/admin", "layout")
}

export async function reindexClip() {
  await requireAdmin()
  await db.execute(sql`delete from node_embeddings`)
  await db.execute(sql`update file_versions set ml_done = array(select x from unnest(ml_done) x where x not like 'clip:%')`)
  await audit("settings", { detail: "ai: look at all pictures again" })
  revalidatePath("/admin", "layout")
}

// Names people gave are lost too: everyone's faces and groups start over.
export async function reindexFaces() {
  await requireAdmin()
  await db.execute(sql`delete from faces`)
  await db.execute(sql`delete from people`)
  await db.execute(sql`update file_versions set ml_done = array_remove(ml_done, 'faces')`)
  await audit("settings", { detail: "ai: find faces again" })
  revalidatePath("/admin", "layout")
}

// Off hides the Places map on the web and in the app. The style URL is a MapLibre style JSON.
export async function setMap(form: FormData) {
  await requireAdmin()
  const raw = String(form.get("mapStyleUrl") ?? "").trim()
  let url: URL | null = null
  try {
    url = new URL(raw)
  } catch {}
  await saveSettings({
    mapEnabled: form.get("mapEnabled") === "on",
    ...(url && /^https?:$/.test(url.protocol) && { mapStyleUrl: url.href }),
    updatedAt: new Date(),
  })
  revalidatePath("/", "layout")
}

// The worker picks these up within a minute. Blank size: the 200 MB default.
export async function setDerive(form: FormData) {
  await requireAdmin()
  const jobs = limit(form, "deriveJobs")
  const n = limit(form, "deriveMax")
  const unit = UNITS[String(form.get("unit"))] ?? UNITS.MB
  await saveSettings({
    deriveConcurrency: Math.min(Math.round(jobs ?? 1), 8) || 1,
    deriveMaxBytes:
      n === null ? 200 * 2 ** 20 : Math.max(2 ** 20, Math.round(n * unit)),
    updatedAt: new Date(),
  })
  revalidatePath("/admin", "layout")
}

// Data-saver video copies: the worker makes 720p and 480p copies of videos. Blank cap: no limit
// on their total size. Off stops new copies; existing ones keep playing.
export async function setVideoCopies(form: FormData) {
  await requireAdmin()
  const n = limit(form, "cap")
  const unit = UNITS[String(form.get("unit"))] ?? UNITS.GB
  await saveSettings({
    videoCopies: form.get("enabled") === "on",
    videoCopyCapBytes: n === null ? null : Math.round(n * unit),
    updatedAt: new Date(),
  })
  revalidatePath("/", "layout")
}

// Removes every copy and switches copies off, or the sweep would start making them again.
export async function deleteVideoCopies() {
  await requireAdmin()
  const n = await turnCopiesOffAndDelete()
  await audit("settings", { detail: `videoCopies: deleted ${n} copies` })
  revalidatePath("/", "layout")
}

// Off stops new vaults; existing ones keep working for their owners.
export async function setVaultPolicy(form: FormData) {
  await requireAdmin()
  const cap = limit(form, "maxVaults")
  await saveSettings({
    vaultsEnabled: form.get("enabled") === "on",
    vaultLinksEnabled: form.get("links") === "on",
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
  await saveSettings({ passwordPolicy, updatedAt: new Date() })
  revalidatePath("/", "layout")
}

export async function setLinkPolicy(form: FormData) {
  await requireAdmin()
  const days = limit(form, "maxLinkDays")
  await saveSettings({
    publicLinksEnabled: form.get("enabled") === "on",
    maxLinkDays: days && Math.min(Math.floor(days), 3650),
    requireLinkPassword: form.get("requirePassword") === "on",
    updatedAt: new Date(),
  })
  revalidatePath("/admin", "layout")
}

export async function setTransferPolicy(form: FormData) {
  await requireAdmin()
  const days = limit(form, "maxDays")
  const size = limit(form, "maxSize")
  const unit = UNITS[String(form.get("unit"))] ?? UNITS.GB
  await saveSettings({
    transfersEnabled: form.get("enabled") === "on",
    transferMaxDays: days && Math.min(Math.floor(days), 30),
    transferMaxBytes: size === null ? null : Math.round(size * unit),
    updatedAt: new Date(),
  })
  revalidatePath("/", "layout")
}

export async function revokeTransfer(id: string) {
  await requireAdmin()
  const gone = await db
    .update(transfers)
    .set({ revokedAt: new Date() })
    .where(and(eq(transfers.id, String(id)), isNull(transfers.revokedAt)))
    .returning({ by: transfers.senderId })
  if (gone[0]) await audit("transfer_revoke", { targetId: gone[0].by })
  revalidatePath("/admin", "layout")
}

// Settings a "Reset to default" button may touch. Email has its own form.
const RESETTABLE: SettingKey[] = [
  "signupMode",
  "require2fa",
  "passwordPolicy",
  "multiAccount",
  "maxAccounts",
  "savedLogins",
  "savedLoginsAdmins",
  "deviceLinks",
  "defaultQuotaBytes",
  "maxUploadBytes",
  "maxPdfEditBytes",
  "uploadSpeedBytes",
  "blockedExtensions",
  "versionKeepLast",
  "versionMaxAgeDays",
  "trashRetentionDays",
  "activityRetentionDays",
  "publicLinksEnabled",
  "requireLinkPassword",
  "maxLinkDays",
  "transfersEnabled",
  "transferMaxDays",
  "transferMaxBytes",
  "vaultsEnabled",
  "vaultLinksEnabled",
  "maxVaultsPerMember",
  "officeUrl",
  "webdav",
  "ocrLangs",
  "ocrMode",
  "ocrVideoMaxMin",
  "mlUrl",
  "mlSpeech",
  "mlClip",
  "mlFaces",
  "whisperModel",
  "clipModel",
  "facesDefault",
  "aiAccess",
  "mapEnabled",
  "mapStyleUrl",
  "deriveConcurrency",
  "deriveMaxBytes",
  "videoCopies",
  "videoCopyCapBytes",
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
  await saveSettings({ ...set, updatedAt: new Date() })
  if ("healthIntervalMin" in set)
    await scheduleHealth(set.healthIntervalMin as number | null)
  if (
    keys.some((k) => /^backup(Db|Files)(IntervalH|Start)$|^backupTz$/.test(k))
  )
    await scheduleBackups(await getSettings()).catch(() => {})
  revalidatePath("/", "layout")
}

export async function revokeLink(id: string) {
  await requireAdmin()
  const gone = await db
    .delete(shares)
    .where(and(eq(shares.id, String(id)), isNotNull(shares.token)))
    .returning({ by: shares.createdBy })
  if (gone[0]) await audit("link_revoke", { targetId: gone[0].by ?? undefined })
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
