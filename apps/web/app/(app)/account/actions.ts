"use server"

import { revalidatePath } from "next/cache"

import { NOTIFICATION_KINDS } from "@/lib/db/schema"
import * as svc from "@/lib/services/account"
import { getSession, requireMember } from "@/lib/session"

export type FormState = svc.FormState

const ENDED = { error: "Your session ended. Sign in again." }

// Also clears a temporary password an admin set, and signs out every other device.
export async function changePassword(
  _: FormState,
  form: FormData
): Promise<FormState> {
  const session = await getSession()
  if (!session) return ENDED
  const newPassword = String(form.get("newPassword"))
  if (newPassword !== String(form.get("confirm")))
    return { error: "The new passwords don't match." }
  const r = await svc.changePassword(
    session.user,
    String(form.get("currentPassword")),
    newPassword
  )
  if (r?.ok) revalidatePath("/", "layout")
  return r
}

export async function resendVerification(): Promise<FormState> {
  const session = await getSession()
  if (!session) return ENDED
  return svc.resendVerification(session.user)
}

// A bell and an email checkbox per kind of notification; unchecked turns that channel off.
export async function setNotificationPrefs(form: FormData) {
  const session = await getSession()
  if (!session) return
  await svc.setNotificationPrefs(
    session.user,
    Object.fromEntries(
      NOTIFICATION_KINDS.map((kind) => [
        kind,
        {
          email: form.get(`${kind}:email`) === "on",
          bell: form.get(`${kind}:bell`) === "on",
        },
      ])
    )
  )
  revalidatePath("/account")
}

// How long an unlocked vault stays open without a click or key press.
export async function setVaultLock(form: FormData) {
  const session = await getSession()
  if (!session) return
  await svc.setVaultLock(session.user, Number(form.get("minutes")))
  revalidatePath("/", "layout")
}

export async function pickAvatar(choice: string) {
  const session = await getSession()
  if (!session) return
  if (await svc.pickAvatar(session.user, choice))
    revalidatePath("/", "layout")
}

// The browser crops and shrinks the photo to a 256px JPEG before sending it.
export async function uploadAvatar(form: FormData): Promise<FormState> {
  const session = await getSession()
  if (!session) return ENDED
  const r = await svc.uploadAvatar(session.user, form.get("file"))
  if (r?.ok) revalidatePath("/", "layout")
  return r
}

// The new password is returned once and never stored, only its hash.
export async function createAppPassword(
  rawName: string,
  scope: string
): Promise<{ password?: string; error?: string }> {
  const r = await svc.createAppPassword(await requireMember(), rawName, scope)
  if (r.password) revalidatePath("/account")
  return r
}

export async function revokeAppPassword(id: string) {
  await svc.revokeAppPassword(await requireMember(), id)
  revalidatePath("/account")
}
