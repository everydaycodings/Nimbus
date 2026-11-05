import "server-only"

import { APIError } from "better-auth/api"
import { and, count, eq, sql } from "drizzle-orm"
import { headers } from "next/headers"

import { auth } from "@/lib/auth"
import { AVATAR_URL, PRESETS } from "@/lib/avatars"
import { db } from "@/lib/db"
import { hashAppPassword, newAppPassword } from "@/lib/dav/auth"
import {
  ADMIN_KINDS,
  NOTIFICATION_KINDS,
  appPasswords,
  notificationPrefs,
  user,
  type NotificationKind,
} from "@/lib/db/schema"
import { notify } from "@/lib/notify"
import { deleteObject, putObject } from "@/lib/s3"
import { UUID } from "@/lib/file-rules"
import { isAdmin, type Me } from "@/lib/session"

export type FormState = { ok?: boolean; error?: string } | null

// Also clears a temporary password an admin set, and signs out every other
// device. Works for gated accounts: it's how a temporary password gets replaced.
// The caller has checked the two new passwords match.
export async function changePassword(
  me: Me,
  currentPassword: string,
  newPassword: string
): Promise<FormState> {
  try {
    await auth.api.changePassword({
      headers: await headers(),
      body: { currentPassword, newPassword, revokeOtherSessions: true },
    })
  } catch (e) {
    if (e instanceof APIError)
      return {
        error:
          e.body?.code === "INVALID_PASSWORD"
            ? "Your current password is wrong."
            : (e.body?.message ?? "Couldn't change your password."),
      }
    throw e
  }
  await db
    .update(user)
    .set({ passwordTemporary: false })
    .where(eq(user.id, me.id))
  return { ok: true }
}

export async function resendVerification(me: Me): Promise<FormState> {
  await auth.api.sendVerificationEmail({
    body: { email: me.email, callbackURL: "/" },
  })
  return { ok: true }
}

// The kinds this member sees a row for; admins also get the admin-only ones.
export const prefKinds = (me: Me) =>
  NOTIFICATION_KINDS.filter((k) => !ADMIN_KINDS.includes(k) || isAdmin(me.role))

// A bell and an email flag per kind of notification; false turns that channel
// off. Kinds missing from `prefs`, or hidden from this member, stay as they are.
export async function setNotificationPrefs(
  me: Me,
  prefs: Partial<Record<NotificationKind, { email: boolean; bell: boolean }>>
) {
  const rows = prefKinds(me).flatMap((kind) => {
    const p = prefs[kind]
    return p ? [{ userId: me.id, kind, email: p.email, bell: p.bell }] : []
  })
  if (!rows.length) return
  await db
    .insert(notificationPrefs)
    .values(rows)
    .onConflictDoUpdate({
      target: [notificationPrefs.userId, notificationPrefs.kind],
      set: { email: sql`excluded.email`, bell: sql`excluded.bell` },
    })
}

export const VAULT_LOCK_MINUTES = [5, 15, 30, 60]

// How long an unlocked vault stays open without a click or key press.
export async function setVaultLock(me: Me, minutes: number) {
  if (!VAULT_LOCK_MINUTES.includes(minutes)) return
  await db
    .update(user)
    .set({ vaultLockMinutes: minutes })
    .where(eq(user.id, me.id))
}

// A preset, the provider photo kept from sign-up, or an uploaded image. A
// replaced upload is deleted from storage.
async function putAvatar(userId: string, image: string, old: string | null) {
  await db.update(user).set({ image }).where(eq(user.id, userId))
  if (old?.startsWith(AVATAR_URL) && old !== image)
    await deleteObject(`avatars/${old.slice(AVATAR_URL.length)}.jpg`).catch(
      () => {}
    )
}

export async function pickAvatar(me: Me, choice: string) {
  const image =
    choice === "provider" ? me.providerImage : PRESETS.find((p) => p === choice)
  if (image) await putAvatar(me.id, image, me.image ?? null)
  return Boolean(image)
}

// The client crops and shrinks the photo to a 256px JPEG before sending it.
export async function uploadAvatar(me: Me, file: unknown): Promise<FormState> {
  if (!(file instanceof File) || file.size > 300_000)
    return { error: "That image is too large." }
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff)
    return { error: "That image couldn't be read." }
  const key = `${me.id}-${crypto.randomUUID().slice(0, 8)}`
  await putObject(`avatars/${key}.jpg`, bytes, "image/jpeg")
  await putAvatar(me.id, AVATAR_URL + key, me.image ?? null)
  return { ok: true }
}

const APP_SCOPES = ["rw", "ro"] as const

// The new password is returned once and never stored, only its hash.
export async function createAppPassword(
  me: Me,
  rawName: string,
  scope: string
): Promise<{ password?: string; error?: string }> {
  const name = String(rawName ?? "").trim().slice(0, 60)
  if (!name) return { error: "Name the device, like “Laptop” or “Phone”." }
  if (!APP_SCOPES.includes(scope as "rw")) return { error: "Pick an access level." }
  const [{ n }] = await db
    .select({ n: count() })
    .from(appPasswords)
    .where(eq(appPasswords.userId, me.id))
  if (n >= 50) return { error: "You have 50 app passwords. Revoke one first." }
  const password = newAppPassword()
  await db.insert(appPasswords).values({
    userId: me.id,
    name,
    scope: scope as "rw" | "ro",
    hash: hashAppPassword(password),
    lastFour: password.slice(-4),
  })
  const h = await headers()
  await notify(me.id, "app_password", {
    data: {
      name,
      ip: h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || "",
    },
  })
  return { password }
}

export async function revokeAppPassword(me: Me, id: string) {
  if (!UUID.test(id)) return
  await db
    .delete(appPasswords)
    .where(and(eq(appPasswords.id, id), eq(appPasswords.userId, me.id)))
}
