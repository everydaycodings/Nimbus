// Phone backup (Phase 18): the phone writes contacts-*.vcf and calendar-*.ics into
// My files → Phone backup → <device> and reports here; the web page reads them.
import "server-only"

import { and, asc, desc, eq, isNull } from "drizzle-orm"

import { db } from "@/lib/db"
import { nodes, phoneBackups } from "@/lib/db/schema"
import { notify } from "@/lib/notify"
import type { Me } from "@/lib/session"
import { createFolderAs, trashAs } from "@/lib/tree-ops"

import type { PhoneBackupCopy, PhoneBackupDevice, PhoneBackupType } from "@nimbus/shared/api"

export const PHONE_FOLDER = "Phone backup"
// Days without a new copy before the bell rings.
export const STALE_DAYS = 7

const TYPES: Record<PhoneBackupType, RegExp> = {
  contacts: /^contacts-.*\.vcf$/i,
  calendar: /^calendar-.*\.ics$/i,
}

// The live folder called `name` under `parentId`, made when missing.
async function folder(userId: string, parentId: string | null, name: string) {
  const find = async () => {
    const [row] = await db
      .select({ id: nodes.id, name: nodes.name })
      .from(nodes)
      .where(
        and(
          eq(nodes.ownerId, userId),
          eq(nodes.kind, "folder"),
          isNull(nodes.trashedAt),
          isNull(nodes.vaultId),
          parentId ? eq(nodes.parentId, parentId) : isNull(nodes.parentId)
        )
      )
      .then((rows) => rows.filter((r) => r.name.toLowerCase() === name.toLowerCase()))
    return row
  }
  const have = await find()
  if (have) return { id: have.id }
  const made = await createFolderAs(userId, parentId, name)
  if (made.id) return { id: made.id }
  // Lost a race with another call: it exists now.
  const again = await find()
  return again ? { id: again.id } : { error: made.error }
}

export async function registerPhone(
  me: Me,
  b: { deviceName: string; contacts: boolean; calendar: boolean }
): Promise<{ error?: string; id?: string; folderId?: string }> {
  const root = await folder(me.id, null, PHONE_FOLDER)
  if (!root.id) return { error: root.error }
  await db.update(nodes).set({ systemKind: "phone_backup" }).where(and(eq(nodes.id, root.id), isNull(nodes.systemKind)))
  const mine = await folder(me.id, root.id, b.deviceName)
  if (!mine.id) return { error: mine.error }
  const [row] = await db
    .insert(phoneBackups)
    .values({ userId: me.id, deviceName: b.deviceName, folderId: mine.id, contacts: b.contacts, calendar: b.calendar })
    .onConflictDoUpdate({
      target: [phoneBackups.userId, phoneBackups.deviceName],
      set: { folderId: mine.id, contacts: b.contacts, calendar: b.calendar },
    })
    .returning({ id: phoneBackups.id })
  return { id: row.id, folderId: mine.id }
}

const copiesIn = async (folderId: string): Promise<PhoneBackupCopy[]> => {
  const rows = await db
    .select({ id: nodes.id, name: nodes.name, size: nodes.size, createdAt: nodes.createdAt })
    .from(nodes)
    .where(and(eq(nodes.parentId, folderId), eq(nodes.kind, "file"), isNull(nodes.trashedAt)))
    .orderBy(desc(nodes.createdAt))
  return rows.flatMap((r) => {
    const type = (Object.keys(TYPES) as PhoneBackupType[]).find((t) => TYPES[t].test(r.name))
    return type ? [{ id: r.id, name: r.name, size: r.size, createdAt: r.createdAt.toISOString(), type }] : []
  })
}

export async function listPhones(me: Me): Promise<PhoneBackupDevice[]> {
  const rows = await db
    .select()
    .from(phoneBackups)
    .where(eq(phoneBackups.userId, me.id))
    .orderBy(asc(phoneBackups.deviceName))
  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      deviceName: r.deviceName,
      folderId: r.folderId,
      contacts: r.contacts,
      calendar: r.calendar,
      lastContactsAt: r.lastContactsAt?.toISOString() ?? null,
      lastCalendarAt: r.lastCalendarAt?.toISOString() ?? null,
      copies: r.folderId ? await copiesIn(r.folderId) : [],
    }))
  )
}

// A copy of `type` is in the folder: note it, and trash older ones beyond `keep` (null keeps all).
export async function finishCopy(
  me: Me,
  id: string,
  type: PhoneBackupType,
  keep: number | null
): Promise<{ error?: string; trashed?: number }> {
  const [row] = await db
    .select()
    .from(phoneBackups)
    .where(and(eq(phoneBackups.id, id), eq(phoneBackups.userId, me.id)))
  if (!row) return { error: "That phone is gone." }
  await db
    .update(phoneBackups)
    .set({ [type === "contacts" ? "lastContactsAt" : "lastCalendarAt"]: new Date(), staleNotifiedAt: null })
    .where(eq(phoneBackups.id, id))
  if (keep === null || !row.folderId) return { trashed: 0 }
  const old = (await copiesIn(row.folderId)).filter((c) => c.type === type).slice(keep)
  if (!old.length) return { trashed: 0 }
  const r = await trashAs(me.id, old.map((c) => c.id))
  return r.error ? r : { trashed: old.length }
}

// Daily: a phone with backup on and no new copy for STALE_DAYS gets one bell, until its next copy.
export async function alertStalePhones() {
  const rows = await db
    .select()
    .from(phoneBackups)
    .where(isNull(phoneBackups.staleNotifiedAt))
  const cutoff = Date.now() - STALE_DAYS * 86_400_000
  const stale = rows.filter((r) => {
    if (!r.contacts && !r.calendar) return false
    const last = Math.max(
      r.contacts ? (r.lastContactsAt?.getTime() ?? 0) : 0,
      r.calendar ? (r.lastCalendarAt?.getTime() ?? 0) : 0,
      r.createdAt.getTime()
    )
    return last < cutoff
  })
  for (const r of stale) {
    await notify(r.userId, "phone_backup", { data: { device: r.deviceName, id: r.id } })
    await db.update(phoneBackups).set({ staleNotifiedAt: new Date() }).where(eq(phoneBackups.id, r.id))
  }
}
