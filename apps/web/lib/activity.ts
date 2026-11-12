import "server-only"

import { and, desc, eq, inArray, sql } from "drizzle-orm"

import { accessOne } from "@/lib/access"
import {
  ACTIVITY_LIMIT,
  retentionCutoff,
  visibleTypes,
  type ActivityType,
} from "@/lib/activity-rules"
import { db } from "@/lib/db"
import { activity, fileVersions, nodes, pointRestores, settings, user } from "@/lib/db/schema"
import { UUID } from "@/lib/file-rules"
import { undoable } from "@/lib/point-restore-rules"

type Row = {
  nodeId: string
  actorId: string | null
  type: ActivityType
  detail?: string | null
  // Renames and moves: what the name and folder were, for Restore to a point in time.
  fromName?: string | null
  fromParentId?: string | null
  restoreId?: string | null
}

// Logs what someone did. A failure here never undoes the change itself.
export async function record(rows: Row[]) {
  if (!rows.length) return
  try {
    await db.insert(activity).values(rows)
  } catch (e) {
    console.error("[activity] couldn't record:", e)
  }
}

export const recordOne = (
  nodeId: string,
  actorId: string | null,
  type: ActivityType,
  detail?: string | null
) => record([{ nodeId, actorId, type, detail }])

// A saved upload is a new file at version 1, an edit after that.
export async function recordSaved(
  nodeId: string,
  versionId: string,
  actorId: string | null,
  detail?: string
) {
  const [v] = await db
    .select({ n: fileVersions.number })
    .from(fileVersions)
    .where(eq(fileVersions.id, versionId))
  await recordOne(nodeId, actorId, v && v.n > 1 ? "version" : "upload", detail)
}

export type ActivityEvent = {
  id: string
  type: ActivityType
  detail: string | null
  at: string
  actorId: string | null
  actorName: string | null
  nodeId: string
  /** The item's name now; for a folder's feed this tells its children apart. */
  name: string
  /** A "Restored to…" entry: the time it went back to, and the id to undo it with while that still works. */
  restore: { at: string; undoId: string | null } | null
}

// Newest first. A folder's feed includes everything inside it (sharing covers the whole
// tree, so whoever may open the folder may see its children's events). Null: not theirs to see.
export async function listActivity(
  userId: string,
  id: string,
  { offset = 0, limit = ACTIVITY_LIMIT } = {}
): Promise<{ events: ActivityEvent[]; total: number } | null> {
  if (!UUID.test(id)) return null
  const a = await accessOne(userId, id)
  if (!a || (a.trashed && a.role !== "owner")) return null
  const ids =
    a.kind === "folder"
      ? (
          await db.execute<{ id: string }>(sql`
            with recursive d as (
              select id from nodes where id = ${id}
              union all
              select n.id from nodes n join d on n.parent_id = d.id
            )
            select id from d`)
        ).map((r) => r.id)
      : [id]
  const where = and(
    inArray(activity.nodeId, ids),
    inArray(activity.type, visibleTypes(a.role))
  )
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(activity)
    .where(where)
  const rows = await db
    .select({
      id: activity.id,
      type: activity.type,
      detail: activity.detail,
      at: activity.at,
      actorId: activity.actorId,
      actorName: user.name,
      nodeId: activity.nodeId,
      name: nodes.name,
      pr: pointRestores,
    })
    .from(activity)
    .innerJoin(nodes, eq(nodes.id, activity.nodeId))
    .leftJoin(user, eq(user.id, activity.actorId))
    .leftJoin(pointRestores, eq(pointRestores.id, activity.restoreId))
    .where(where)
    .orderBy(desc(activity.at), desc(activity.id))
    .offset(offset)
    .limit(limit)
  return {
    events: rows.map(({ pr, ...r }) => ({
      ...r,
      at: r.at.toISOString(),
      restore: pr
        ? {
            at: pr.at.toISOString(),
            // Only the owner may undo.
            undoId: a.role === "owner" && undoable(pr.createdAt.getTime(), pr.undoneAt) ? pr.id : null,
          }
        : null,
    })),
    total,
  }
}

// Run with the hourly purge.
export async function purgeActivity() {
  const [s] = await db
    .select({ days: settings.activityRetentionDays })
    .from(settings)
  const cutoff = retentionCutoff(s?.days ?? null)
  if (cutoff) await db.delete(activity).where(sql`${activity.at} < ${cutoff.toISOString()}`)
}
