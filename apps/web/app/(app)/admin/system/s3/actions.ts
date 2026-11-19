"use server"

import { revalidatePath } from "next/cache"

import { saveSettings } from "@/lib/audit"
import { adminSetKeyDisabled } from "@/lib/s3api/bucket-config"
import { requireAdmin } from "@/lib/session"

// "Allow public buckets" and the default bucket quota, audited through saveSettings.
export async function setS3Buckets(form: FormData) {
  await requireAdmin()
  const size = Number(String(form.get("s3DefaultQuota") ?? "").trim())
  const unit = String(form.get("unit")) === "TB" ? 2 ** 40 : 2 ** 30
  await saveSettings({
    s3PublicAllowed: form.get("s3PublicAllowed") === "on",
    s3DefaultQuota: Number.isFinite(size) && size > 0 ? Math.round(size * unit) : null,
    updatedAt: new Date(),
  })
  revalidatePath("/", "layout")
}

export async function disableS3Key(id: string, disabled: boolean) {
  await requireAdmin()
  const r = await adminSetKeyDisabled(String(id), disabled)
  if (!r.error) revalidatePath("/", "layout")
  return r
}
