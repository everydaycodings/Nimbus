// Resume positions for long media, synced to the account (Phase 16).
import "server-only"

import { and, eq } from "drizzle-orm"

import { db } from "@/lib/db"
import { playbackPositions } from "@/lib/db/schema"
import { openableFile } from "@/lib/files"
import { resumeAction } from "@/lib/playback-rules"
import type { Me } from "@/lib/session"

// undefined: not a file I can open. null: no position kept.
export async function getPosition(me: Me, id: string) {
  if (!(await openableFile(me.id, id))) return undefined
  const [r] = await db
    .select()
    .from(playbackPositions)
    .where(and(eq(playbackPositions.userId, me.id), eq(playbackPositions.nodeId, id)))
  return r
    ? {
        position: r.positionSec,
        duration: r.durationSec,
        updatedAt: r.updatedAt.toISOString(),
      }
    : null
}

// undefined: not a file I can open. Else whether a position is now stored.
export async function savePosition(me: Me, id: string, position: number, duration: number) {
  if (!(await openableFile(me.id, id))) return undefined
  const action = resumeAction(position, duration)
  const mine = and(eq(playbackPositions.userId, me.id), eq(playbackPositions.nodeId, id))
  if (action !== "save") {
    await db.delete(playbackPositions).where(mine)
    return false
  }
  await db
    .insert(playbackPositions)
    .values({ userId: me.id, nodeId: id, positionSec: position, durationSec: duration })
    .onConflictDoUpdate({
      target: [playbackPositions.userId, playbackPositions.nodeId],
      set: { positionSec: position, durationSec: duration, updatedAt: new Date() },
    })
  return true
}
