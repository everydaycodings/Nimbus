"use server"

import { randomBytes } from "node:crypto"
import { eq, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { db } from "@/lib/db"
import {
  SIGNUP_MODES,
  invites,
  settings,
  type SignupMode,
} from "@/lib/db/schema"
import { requireAdmin } from "@/lib/session"

const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/
const DAY = 24 * 60 * 60 * 1000

export async function setSignupMode(form: FormData) {
  await requireAdmin()
  const mode = form.get("mode") as SignupMode
  if (!SIGNUP_MODES.includes(mode)) return
  await db.update(settings).set({ signupMode: mode, updatedAt: new Date() })
  revalidatePath("/admin/settings")
}

export async function addTrustedDomain(form: FormData) {
  await requireAdmin()
  const domain = String(form.get("domain") ?? "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
  if (!DOMAIN.test(domain)) return
  await db
    .update(settings)
    .set({
      trustedDomains: sql`array_append(${settings.trustedDomains}, ${domain})`,
      updatedAt: new Date(),
    })
    .where(sql`not (${domain} = any(${settings.trustedDomains}))`)
  revalidatePath("/admin/settings")
}

export async function removeTrustedDomain(domain: string) {
  await requireAdmin()
  await db.update(settings).set({
    trustedDomains: sql`array_remove(${settings.trustedDomains}, ${domain})`,
    updatedAt: new Date(),
  })
  revalidatePath("/admin/settings")
}

export async function createInvite(form: FormData) {
  const actor = await requireAdmin()
  const days = Number(form.get("expires"))
  const maxUses = Number(form.get("maxUses"))
  await db.insert(invites).values({
    token: randomBytes(18).toString("base64url"),
    createdBy: actor.id,
    expiresAt: days > 0 ? new Date(Date.now() + days * DAY) : null,
    maxUses: Number.isInteger(maxUses) && maxUses > 0 ? maxUses : null,
  })
  revalidatePath("/admin/settings")
}

export async function revokeInvite(id: string) {
  await requireAdmin()
  await db.delete(invites).where(eq(invites.id, id))
  revalidatePath("/admin/settings")
}
