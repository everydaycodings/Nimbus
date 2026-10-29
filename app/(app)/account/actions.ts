"use server"

import { APIError } from "better-auth/api"
import { eq, sql } from "drizzle-orm"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"

import { auth } from "@/lib/auth"
import { AVATAR_URL, PRESETS } from "@/lib/avatars"
import { db } from "@/lib/db"
import {
  ADMIN_KINDS,
  NOTIFICATION_KINDS,
  notificationPrefs,
  user,
} from "@/lib/db/schema"
import { deleteObject, putObject } from "@/lib/s3"
import { getSession, isAdmin } from "@/lib/session"

export type FormState = { ok?: boolean; error?: string } | null

// Also clears a temporary password an admin set, and signs out every other device.
export async function changePassword(
  _: FormState,
  form: FormData
): Promise<FormState> {
  const session = await getSession()
  if (!session) return { error: "Your session ended. Sign in again." }
  const newPassword = String(form.get("newPassword"))
  if (newPassword !== String(form.get("confirm")))
    return { error: "The new passwords don't match." }
  try {
    await auth.api.changePassword({
      headers: await headers(),
      body: {
        currentPassword: String(form.get("currentPassword")),
        newPassword,
        revokeOtherSessions: true,
      },
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
    .where(eq(user.id, session.user.id))
  revalidatePath("/", "layout")
  return { ok: true }
}

export async function resendVerification(): Promise<FormState> {
  const session = await getSession()
  if (!session) return { error: "Your session ended. Sign in again." }
  await auth.api.sendVerificationEmail({
    body: { email: session.user.email, callbackURL: "/" },
  })
  return { ok: true }
}

// A bell and an email checkbox per kind of notification; unchecked turns that channel off.
export async function setNotificationPrefs(form: FormData) {
  const session = await getSession()
  if (!session) return
  // Members don't see the admin-only rows; leave those settings alone for later.
  const kinds = NOTIFICATION_KINDS.filter(
    (k) => !ADMIN_KINDS.includes(k) || isAdmin(session.user.role)
  )
  const rows = kinds.map((kind) => ({
    userId: session.user.id,
    kind,
    email: form.get(`${kind}:email`) === "on",
    bell: form.get(`${kind}:bell`) === "on",
  }))
  await db
    .insert(notificationPrefs)
    .values(rows)
    .onConflictDoUpdate({
      target: [notificationPrefs.userId, notificationPrefs.kind],
      set: { email: sql`excluded.email`, bell: sql`excluded.bell` },
    })
  revalidatePath("/account")
}

// How long an unlocked vault stays open without a click or key press.
export async function setVaultLock(form: FormData) {
  const session = await getSession()
  if (!session) return
  const minutes = Number(form.get("minutes"))
  if (![5, 15, 30, 60].includes(minutes)) return
  await db
    .update(user)
    .set({ vaultLockMinutes: minutes })
    .where(eq(user.id, session.user.id))
  revalidatePath("/", "layout")
}

// A preset, the provider photo kept from sign-up, or an uploaded image. A
// replaced upload is deleted from storage.
async function putAvatar(userId: string, image: string, old: string | null) {
  await db.update(user).set({ image }).where(eq(user.id, userId))
  if (old?.startsWith(AVATAR_URL) && old !== image)
    await deleteObject(`avatars/${old.slice(AVATAR_URL.length)}.jpg`).catch(
      () => {}
    )
  revalidatePath("/", "layout")
}

export async function pickAvatar(choice: string) {
  const session = await getSession()
  if (!session) return
  const me = session.user
  const image =
    choice === "provider" ? me.providerImage : PRESETS.find((p) => p === choice)
  if (image) await putAvatar(me.id, image, me.image ?? null)
}

// The browser crops and shrinks the photo to a 256px JPEG before sending it.
export async function uploadAvatar(form: FormData): Promise<FormState> {
  const session = await getSession()
  if (!session) return { error: "Your session ended. Sign in again." }
  const file = form.get("file")
  if (!(file instanceof File) || file.size > 300_000)
    return { error: "That image is too large." }
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff)
    return { error: "That image couldn't be read." }
  const key = `${session.user.id}-${crypto.randomUUID().slice(0, 8)}`
  await putObject(`avatars/${key}.jpg`, bytes, "image/jpeg")
  await putAvatar(session.user.id, AVATAR_URL + key, session.user.image ?? null)
  return { ok: true }
}
