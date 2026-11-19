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
