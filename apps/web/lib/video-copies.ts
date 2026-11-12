// Data-saver video copies and what plays where: the rows scripts/transcode.ts writes,
// the "make copy" request, and the cast choice. Rules are in lib/playback-rules.ts.
import "server-only"

import { and, eq, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { videoRenditions } from "@/lib/db/schema"
import { mimeOf, previewKind } from "@/lib/file-rules"
import { openableFile } from "@/lib/files"
import {
  QUALITIES,
  castLifetime,
  castableOriginal,
  type Quality,
} from "@/lib/playback-rules"
import { artUrl, castArt } from "@/lib/cast-art"
import { previewImageUrl } from "@/lib/image-preview"
import { enqueue, enqueueTranscode } from "@/lib/redis"
import { presignGet, removeObjects } from "@/lib/s3"
import { saveSettings } from "@/lib/audit"
import type { Me } from "@/lib/session"
import { getSettings } from "@/lib/signup"

export type CopyRow = typeof videoRenditions.$inferSelect

export const copiesOf = (sourceKey: string) =>
  db.select().from(videoRenditions).where(eq(videoRenditions.sourceKey, sourceKey))

// The copy's storage key if that size is ready, else null (play the original).
export async function copyKey(sourceKey: string, quality: Quality) {
  const [row] = await db
    .select({ key: videoRenditions.key })
    .from(videoRenditions)
    .where(
      and(
        eq(videoRenditions.sourceKey, sourceKey),
        eq(videoRenditions.height, quality),
        eq(videoRenditions.status, "done")
      )
    )
  return row?.key ?? null
}

// Sizes that are ready, biggest first.
export const readyHeights = (rows: CopyRow[]) =>
  rows
    .filter((r) => r.status === "done")
    .map((r) => r.height)
    .sort((a, b) => b - a)

// Ready sizes of a file's current version, biggest first: [] for anything but a video with copies.
export async function readyCopyHeights(nodeId: string) {
  const rows = await db.execute<{ height: number }>(sql`
    select r.height from video_renditions r join nodes n on n.s3_key = r.source_key
    where n.id = ${nodeId} and r.status = 'done' order by r.height desc`)
  return rows.map((r) => r.height)
}

// A copy of `quality` (or the original) as a presigned URL: what ?quality= redirects to.
export async function streamUrl(
  file: { key: string; name: string },
  quality: Quality | null,
  opts: { inline?: boolean; expiresIn?: number; type?: string } = {}
) {
  const key = quality && (await copyKey(file.key, quality))
  if (!key) return presignGet(file.key, file.name, opts)
  const name = file.name.replace(/\.[^.]+$/, "") + `-${quality}p.mp4`
  return presignGet(key, name, { ...opts, type: "video/mp4" })
}

export async function copyStats() {
  const [r] = await db.execute<{ count: number; bytes: number; pending: number; failed: number }>(sql`
    select count(*) filter (where status = 'done')::int as count,
      coalesce(sum(size) filter (where status = 'done'), 0)::float8 as bytes,
      count(*) filter (where status = 'pending')::int as pending,
      count(*) filter (where status = 'failed')::int as failed
    from video_renditions`)
  return r
}

// Admin → Delete all copies: rows first, then the objects (the worker retries S3).
// The sweep would make them again, so callers also switch copies off.
export async function deleteAllCopies() {
  const rows = await db
    .delete(videoRenditions)
    .returning({ key: videoRenditions.key })
  const keys = rows.flatMap((r) => (r.key ? [r.key] : []))
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000)
    await enqueue("delete-keys", { keys: batch }).catch(() =>
      removeObjects(batch).catch((e) => console.error("S3 delete failed", e))
    )
  }
  return keys.length
}

export async function turnCopiesOffAndDelete() {
  await saveSettings({ videoCopies: false, updatedAt: new Date() })
  return deleteAllCopies()
}

// The owner's "Make data-saver copy": queues the worker now. Answers { status } or { error }.
export async function requestCopy(me: Me, id: string, v?: string | null) {
  const file = await openableFile(me.id, id, v)
  if (!file) return { error: "That file isn't available." }
  if (!file.mine) return { error: "Only the owner can make a copy." }
  if (previewKind(file.mime, file.name) !== "video")
    return { error: "Copies are for videos." }
  const s = await getSettings()
  if (!s.videoCopies)
    return { error: "Data-saver copies are off. Ask an admin to turn them on." }
  const stats = await copyStats()
  if (s.videoCopyCapBytes !== null && stats.bytes >= s.videoCopyCapBytes)
    return { error: "The size limit for video copies is reached." }
  const rows = await copiesOf(file.key)
  if (rows.length && rows.every((r) => r.status === "done" || r.status === "skipped"))
    return { status: "done" as const }
  if (rows.some((r) => r.status === "pending")) return { status: "pending" as const }
  await db
    .insert(videoRenditions)
    .values(QUALITIES.map((height) => ({ nodeId: id, sourceKey: file.key, height })))
    .onConflictDoUpdate({
      target: [videoRenditions.sourceKey, videoRenditions.height],
      set: { status: "pending" },
      setWhere: eq(videoRenditions.status, "failed"),
    })
  await enqueueTranscode(id)
  return { status: "pending" as const }
}

// What the Cast button sends: the original when a Chromecast plays it, else the 720p
// copy, else nothing (the client offers "Make copy").
export function castChoice(
  file: { name: string; mime: string | null },
  rows: CopyRow[]
) {
  const kind = previewKind(file.mime, file.name)
  if (kind !== "video" && kind !== "audio" && kind !== "image") return null
  if (kind === "image") return { source: "preview" as const, kind }
  const codec = rows.find((r) => r.codec)?.codec ?? null
  if (castableOriginal(file.name, kind, codec)) return { source: "original" as const, kind }
  if (kind === "video" && rows.some((r) => r.height === 720 && r.status === "done"))
    return { source: "copy" as const, kind, quality: 720 as const }
  return { source: "none" as const, kind }
}

export async function castUrl(
  me: Me,
  id: string,
  durationSec: number | null,
  v?: string | null
) {
  const file = await openableFile(me.id, id, v)
  if (!file) return { error: "That file isn't available." }
  const rows = await copiesOf(file.key)
  const pick = castChoice(file, rows)
  if (!pick) return { error: "This kind of file can't be cast." }
  if (pick.source === "none") return { error: "no-copy" }
  const expiresIn = castLifetime(durationSec)
  // Cover art or poster, when there is one (not for photos: they are the picture).
  const art =
    pick.kind !== "image" && (await castArt(file).then((a) => a !== null, () => false))
      ? { artUrl: artUrl(me.id, id, expiresIn) }
      : {}
  if (pick.source === "preview") {
    const url = await previewImageUrl(file, expiresIn)
    if (!url) return { error: "That photo can't be shown on a TV." }
    return {
      url,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      quality: "preview" as const,
      contentType: "image/jpeg",
      kind: pick.kind,
    }
  }
  const copy = pick.source === "copy" ? pick.quality : null
  return {
    url: await streamUrl(file, copy, { inline: true, expiresIn, type: copy ? "video/mp4" : mimeOf(file.mime, file.name) }),
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    ...art,
    quality: copy ?? ("original" as const),
    contentType: copy ? "video/mp4" : mimeOf(file.mime, file.name),
    kind: pick.kind,
  }
}

// Sizes and states for the player's picker and the Cast button.
export async function playbackInfo(me: Me, id: string, v?: string | null) {
  const file = await openableFile(me.id, id, v)
  if (!file) return null
  const [rows, s] = await Promise.all([copiesOf(file.key), getSettings()])
  const pick = castChoice(file, rows)
  return {
    copiesEnabled: s.videoCopies,
    canMakeCopy:
      s.videoCopies && file.mine && previewKind(file.mime, file.name) === "video",
    copies: rows
      .filter((r) => r.status !== "skipped")
      .map((r) => ({ height: r.height, status: r.status, size: r.size }))
      .sort((a, b) => b.height - a.height),
    cast: pick?.source ?? "none",
  }
}
