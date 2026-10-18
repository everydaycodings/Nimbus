"use server"

import { and, eq, isNotNull } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { db } from "@/lib/db"
import { shares } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/session"

export async function revokeLink(id: string) {
  await requireAdmin()
  await db
    .delete(shares)
    .where(and(eq(shares.id, String(id)), isNotNull(shares.token)))
  revalidatePath("/admin/links")
}
