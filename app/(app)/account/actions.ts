"use server"

import { APIError } from "better-auth/api"
import { eq } from "drizzle-orm"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { user } from "@/lib/db/schema"
import { getSession } from "@/lib/session"

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
