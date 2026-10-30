"use server"

import { randomBytes } from "node:crypto"
import { and, eq, ne } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { audit } from "@/lib/audit"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import {
  account,
  appPasswords,
  savedLogins,
  session,
  twoFactor,
  user,
  type Role,
  type Status,
} from "@/lib/db/schema"
import { appUrl, message, sendInBackground } from "@/lib/email"
import { notify } from "@/lib/notify"
import { getUsage } from "@/lib/quota"
import { forgetSavedLogins } from "@/lib/saved-logins"
import { requireAdmin } from "@/lib/session"
import { destroyVault, getVault } from "@/lib/vault"

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
  if (changed) await audit("status", { targetId, detail: status })
  if (changed && status === "rejected") await forgetSavedLogins(targetId)
  if (changed && status === "active")
    sendInBackground(
      message({
        to: changed.email,
        subject: "You're in: your Nimbus account is ready",
        heading: "Your account is ready",
        lines: [
          `Hi ${changed.name}, an admin approved your account. You can sign in and start storing files.`,
        ],
        action: { label: "Open Nimbus", url: appUrl("/") },
      })
    )
  revalidatePath("/", "layout")
}

// Bulk approve or decline: every checked "id" in the form, with setStatus's rules.
export async function setStatusMany(status: Status, form: FormData) {
  for (const id of form.getAll("id")) await setStatus(String(id), status)
}

// Only the owner promotes or demotes admins. The owner role is never assigned here.
export async function setRole(targetId: string, role: Role) {
  const actor = await requireAdmin()
  if (actor.role !== "owner" || !ASSIGNABLE_ROLES.includes(role)) return
  const changed = await db
    .update(user)
    .set({ role })
    .where(
      and(eq(user.id, targetId), ne(user.role, "owner"), ne(user.role, role))
    )
    .returning({ id: user.id })
  if (changed.length) await audit("role", { targetId, detail: role })
  await forgetSavedLogins(targetId)
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

// Null goes back to the instance default from /admin/storage/quotas.
export async function setMemberQuota(targetId: string, bytes: number | null) {
  const target = await recoverable(targetId)
  if (!target) return { error: "You can't change storage for this person." }
  if (bytes !== null && !(Number.isFinite(bytes) && bytes > 0))
    return { error: "Enter an amount above zero, or leave it blank." }
  await db
    .update(user)
    .set({ quotaBytes: bytes === null ? null : Math.round(bytes) })
    .where(eq(user.id, target.id))
  await audit("quota", { targetId, detail: String(bytes ?? "default") })
  revalidatePath("/admin/members", "layout")
  return { ok: true }
}

// Null goes back to the default from /admin/storage/uploads.
export async function setMemberSpeed(targetId: string, bytes: number | null) {
  const target = await recoverable(targetId)
  if (!target) return { error: "You can't change uploads for this person." }
  if (bytes !== null && !(Number.isFinite(bytes) && bytes > 0))
    return { error: "Enter a speed above zero, or leave it blank." }
  await db
    .update(user)
    .set({
      uploadSpeedBytes:
        bytes === null ? null : Math.max(1024, Math.round(bytes)),
    })
    .where(eq(user.id, target.id))
  await audit("upload_speed", { targetId, detail: String(bytes ?? "default") })
  revalidatePath("/admin/members", "layout")
  return { ok: true }
}

// The admin's storage view: the same storage_low bell and email, from them.
export async function remindStorage(targetId: string) {
  const admin = await requireAdmin()
  const { used, quota } = await getUsage(targetId)
  if (quota === null) return
  await notify(targetId, "storage_low", {
    actorId: admin.id,
    data: { percent: String(Math.min(100, Math.floor((used / quota) * 100))) },
  })
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
  // A saved login skips the password; without two-factor it would be all it takes.
  await forgetSavedLogins(target.id)
  await audit("reset_2fa", { targetId })
  revalidatePath("/admin/members", "layout")
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
    await tx.delete(savedLogins).where(eq(savedLogins.userId, target.id))
  })
  await audit("temp_password", { targetId })
  revalidatePath("/admin/members", "layout")
  return { password }
}

// For a member who forgot both their passphrase and recovery key, or a vault
// that has to go. Nobody can open it, so deleting is all there is.
export async function deleteMemberVault(targetId: string, vaultId: string) {
  const target = await recoverable(targetId)
  const vault = target && (await getVault(target.id, vaultId))
  if (!vault) return { error: "That vault is already gone." }
  await destroyVault(vault.id)
  await audit("delete_vault", { targetId, detail: vault.name })
  revalidatePath("/admin/members", "layout")
  return { ok: true }
}

// Off makes their app passwords stop working without deleting them.
export async function setMemberWebdav(targetId: string, on: boolean) {
  const target = await recoverable(targetId)
  if (!target) return { error: "You can't change WebDAV for this person." }
  await db
    .update(user)
    .set({ webdavDisabled: !on })
    .where(eq(user.id, target.id))
  await audit("webdav", { targetId, detail: on ? "on" : "off" })
  revalidatePath("/admin/members", "layout")
  return { ok: true }
}

// For a lost laptop or phone.
export async function revokeMemberAppPassword(targetId: string, id: string) {
  const target = await recoverable(targetId)
  if (!target) return { error: "You can't change this person's app passwords." }
  const gone = await db
    .delete(appPasswords)
    .where(and(eq(appPasswords.id, id), eq(appPasswords.userId, target.id)))
    .returning({ name: appPasswords.name })
  if (gone[0])
    await audit("revoke_app_password", { targetId, detail: gone[0].name })
  revalidatePath("/admin/members", "layout")
  return { ok: true }
}
