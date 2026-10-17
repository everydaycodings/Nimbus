"use server"

import { randomBytes } from "node:crypto"
import { and, eq, ne } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import {
  account,
  session,
  twoFactor,
  user,
  type Role,
  type Status,
} from "@/lib/db/schema"
import { appUrl, message, sendInBackground } from "@/lib/email"
import { requireAdmin } from "@/lib/session"

const STATUSES: Status[] = ["pending", "active", "rejected"]
const ASSIGNABLE_ROLES: Role[] = ["admin", "member"]

// Admins approve or reject anyone except the owner and themselves.
export async function setStatus(targetId: string, status: Status) {
  const actor = await requireAdmin()
  if (!STATUSES.includes(status) || targetId === actor.id) return
  const [changed] = await db
    .update(user)
    .set({ status })
    .where(
      and(
        eq(user.id, targetId),
        ne(user.role, "owner"),
        ne(user.status, status)
      )
    )
    .returning({ email: user.email, name: user.name })
  if (changed && status === "active")
    sendInBackground(
      message({
        to: changed.email,
        subject: "You're in: your Nimbus account is ready",
        lines: [
          `Hi ${changed.name}, an admin approved your account. You can sign in and start storing files.`,
        ],
        action: { label: "Open Nimbus", url: appUrl("/") },
      })
    )
  revalidatePath("/", "layout")
}

// Only the owner promotes or demotes admins. The owner role is never assigned here.
export async function setRole(targetId: string, role: Role) {
  const actor = await requireAdmin()
  if (actor.role !== "owner" || !ASSIGNABLE_ROLES.includes(role)) return
  await db
    .update(user)
    .set({ role })
    .where(and(eq(user.id, targetId), ne(user.role, "owner")))
  revalidatePath("/", "layout")
}

// Account recovery is for members; only the owner can recover an admin, and
// nobody can do it to the owner or to themselves.
async function recoverable(targetId: string) {
  const actor = await requireAdmin()
  if (targetId === actor.id) return null
  const [target] = await db.select().from(user).where(eq(user.id, targetId))
  if (!target || target.role === "owner") return null
  if (target.role === "admin" && actor.role !== "owner") return null
  return target
}

// Null goes back to the instance default from /admin/settings.
export async function setMemberQuota(targetId: string, bytes: number | null) {
  const target = await recoverable(targetId)
  if (!target) return { error: "You can't change storage for this person." }
  if (bytes !== null && !(Number.isFinite(bytes) && bytes > 0))
    return { error: "Enter an amount above zero, or leave it blank." }
  await db
    .update(user)
    .set({ quotaBytes: bytes === null ? null : Math.round(bytes) })
    .where(eq(user.id, target.id))
  revalidatePath("/admin/members")
  return { ok: true }
}

// For a member who lost their phone and their backup codes.
export async function resetTwoFactor(targetId: string) {
  const target = await recoverable(targetId)
  if (!target) return { error: "You can't reset two-factor for this person." }
  await db.transaction(async (tx) => {
    await tx.delete(twoFactor).where(eq(twoFactor.userId, target.id))
    await tx
      .update(user)
      .set({ twoFactorEnabled: false })
      .where(eq(user.id, target.id))
  })
  revalidatePath("/admin/members")
  return { ok: true }
}

// The no-email way back in: a one-off password the admin passes on, which the
// member must replace at their next sign-in. Signs them out everywhere.
export async function setTemporaryPassword(targetId: string) {
  const target = await recoverable(targetId)
  if (!target) return { error: "You can't set a password for this person." }
  const password = randomBytes(12)
    .toString("base64url")
    .replace(/(.{4})(?!$)/g, "$1-")
  const hash = await (await auth.$context).password.hash(password)
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(account)
      .set({ password: hash, updatedAt: new Date() })
      .where(
        and(eq(account.userId, target.id), eq(account.providerId, "credential"))
      )
      .returning({ id: account.id })
    // OAuth-only members get a password sign-in added.
    if (updated.length === 0)
      await tx.insert(account).values({
        id: randomBytes(16).toString("hex"),
        accountId: target.id,
        providerId: "credential",
        userId: target.id,
        password: hash,
        updatedAt: new Date(),
      })
    await tx
      .update(user)
      .set({ passwordTemporary: true })
      .where(eq(user.id, target.id))
    await tx.delete(session).where(eq(session.userId, target.id))
  })
  revalidatePath("/admin/members")
  return { password }
}
