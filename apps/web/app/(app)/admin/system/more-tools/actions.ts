"use server"

import { revalidatePath } from "next/cache"

import { saveSettings } from "@/lib/audit"
import { encrypt } from "@/lib/crypto"
import { requireAdmin } from "@/lib/session"

const whole = (form: FormData, field: string, min: number, max: number, fallback: number) => {
  const raw = String(form.get(field) ?? "").trim()
  const n = Math.round(Number(raw))
  return raw && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

// The secret is write-only: blank keeps it, "clear" removes it, anything else replaces it.
export async function setMoreTools(form: FormData) {
  await requireAdmin()
  const secret = String(form.get("githubOauthClientSecret") ?? "").trim()
  await saveSettings({
    gitBackupEnabled: form.get("gitBackupEnabled") === "on",
    gitBackupMinInterval: whole(form, "gitBackupMinInterval", 5, 100_000, 15),
    gitBackupConcurrency: whole(form, "gitBackupConcurrency", 1, 10, 2),
    githubOauthClientId: String(form.get("githubOauthClientId") ?? "").trim() || null,
    ...(form.get("clearSecret") === "on"
      ? { githubOauthClientSecret: null }
      : secret
        ? { githubOauthClientSecret: encrypt(secret) }
        : {}),
    updatedAt: new Date(),
  })
  revalidatePath("/", "layout")
}

export async function setCleanupTool(form: FormData) {
  await requireAdmin()
  await saveSettings({ cleanupToolEnabled: form.get("cleanupToolEnabled") === "on", updatedAt: new Date() })
  revalidatePath("/", "layout")
}

export async function setConvertTool(form: FormData) {
  await requireAdmin()
  const bytes = whole(form, "convertMaxMb", 0, 10_000_000, 0)
  const seconds = whole(form, "convertMaxMinutes", 0, 100_000, 0)
  const hw = String(form.get("convertHwaccel"))
  await saveSettings({
    convertToolEnabled: form.get("convertToolEnabled") === "on",
    convertConcurrency: whole(form, "convertConcurrency", 1, 8, 1),
    convertMaxBytes: bytes > 0 ? bytes * 1024 * 1024 : null,
    convertMaxSeconds: seconds > 0 ? seconds * 60 : null,
    convertDailyMinutes: whole(form, "convertDailyMinutes", 0, 100_000, 0),
    convertHwaccel: hw === "vaapi" || hw === "nvenc" ? hw : "off",
    updatedAt: new Date(),
  })
  revalidatePath("/", "layout")
}

export async function setRegistryTools(form: FormData) {
  await requireAdmin()
  await saveSettings({ registryToolsEnabled: form.get("registryToolsEnabled") === "on", updatedAt: new Date() })
  revalidatePath("/", "layout")
}

// Website Archiver. The browser address is a ws:// or wss:// URL (browserless takes its token as ?token=); blank turns captures off.
export async function setArchiverTool(form: FormData) {
  await requireAdmin()
  const raw = String(form.get("archiverBrowserUrl") ?? "").trim()
  if (raw && !/^wss?:\/\/[^\s]+$/i.test(raw)) throw new Error("The browser address must start with ws:// or wss://.")
  await saveSettings({ archiverToolEnabled: form.get("archiverToolEnabled") === "on", archiverBrowserUrl: raw || null, updatedAt: new Date() })
  revalidatePath("/", "layout")
}

// Cloud Import: the switch and the OAuth apps. Each secret is write-only, like GitHub's: blank keeps it, "Remove" clears it.
export async function setImportTool(form: FormData) {
  await requireAdmin()
  const text = (k: string) => String(form.get(k) ?? "").trim() || null
  const secret = (k: string, clear: string) => {
    const v = String(form.get(k) ?? "").trim()
    return form.get(clear) === "on" ? { [k]: null } : v ? { [k]: encrypt(v) } : {}
  }
  await saveSettings({
    importToolEnabled: form.get("importToolEnabled") === "on",
    importGoogleClientId: text("importGoogleClientId"),
    importDropboxClientId: text("importDropboxClientId"),
    importOnedriveClientId: text("importOnedriveClientId"),
    ...secret("importGoogleClientSecret", "clearGoogle"),
    ...secret("importDropboxClientSecret", "clearDropbox"),
    ...secret("importOnedriveClientSecret", "clearOnedrive"),
    updatedAt: new Date(),
  })
  revalidatePath("/", "layout")
}

// Server Backup: the switch, whether members may use it, and the shortest interval between backups.
export async function setServerBackupTool(form: FormData) {
  await requireAdmin()
  await saveSettings({
    serverBackupEnabled: form.get("serverBackupEnabled") === "on",
    serverBackupMembers: form.get("serverBackupMembers") === "on",
    serverBackupMinInterval: whole(form, "serverBackupMinInterval", 5, 100_000, 60),
    updatedAt: new Date(),
  })
  revalidatePath("/", "layout")
}
