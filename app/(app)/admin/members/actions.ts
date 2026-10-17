"use server"

import { and, eq, ne } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { db } from "@/lib/db"
import { user, type Role, type Status } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/session"

const STATUSES: Status[] = ["pending", "active", "rejected"]
const ASSIGNABLE_ROLES: Role[] = ["admin", "member"]

// Admins approve or reject anyone except the owner and themselves.
export async function setStatus(targetId: string, status: Status) {
  const actor = await requireAdmin()
  if (!STATUSES.includes(status) || targetId === actor.id) return
  await db
    .update(user)
    .set({ status })
    .where(and(eq(user.id, targetId), ne(user.role, "owner")))
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
