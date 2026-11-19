// Daily worker job: one bell per key when its rotation falls due, and one when it has a week left.
import "server-only"

import { and, isNull, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { s3Keys } from "@/lib/db/schema"
import { notify } from "@/lib/notify"

import { EXPIRING_SOON_DAYS } from "./perms"

export async function remindKeys() {
  const due = await db
    .update(s3Keys)
    .set({ rotateNotifiedAt: new Date() })
    .where(
      and(
        isNull(s3Keys.rotateNotifiedAt),
        isNull(s3Keys.disabledAt),
        sql`${s3Keys.rotateEveryDays} is not null and coalesce(${s3Keys.rotatedAt}, ${s3Keys.createdAt}) + ${s3Keys.rotateEveryDays} * interval '1 day' <= now()`
      )
    )
    .returning({ userId: s3Keys.userId, name: s3Keys.name })
  for (const k of due) await notify(k.userId, "s3_key", { data: { what: "rotation_due", name: k.name } })
  const soon = await db
    .update(s3Keys)
    .set({ expiryNotifiedAt: new Date() })
    .where(
      and(
        isNull(s3Keys.expiryNotifiedAt),
        isNull(s3Keys.disabledAt),
        sql`${s3Keys.expiresAt} > now() and ${s3Keys.expiresAt} <= now() + ${`${EXPIRING_SOON_DAYS} days`}::interval`
      )
    )
    .returning({ userId: s3Keys.userId, name: s3Keys.name, expiresAt: s3Keys.expiresAt })
  for (const k of soon) {
    const days = Math.max(Math.ceil((k.expiresAt!.getTime() - Date.now()) / 86_400_000), 0)
    await notify(k.userId, "s3_key", { data: { what: "expiring", name: k.name, days: String(days) } })
  }
  return due.length + soon.length
}
