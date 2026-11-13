// Subtitles as WebVTT for the players and Cast: a .srt/.vtt beside the video in its
// folder (movie.srt, movie.en.vtt), or a text track inside the file (read with ffmpeg).
import "server-only"

import { execFile } from "node:child_process"
import { promisify } from "node:util"

import { and, eq, isNull, sql } from "drizzle-orm"

import { accessOne } from "@/lib/access"
import { db } from "@/lib/db"
import { nodes, nodeSpeech } from "@/lib/db/schema"
import { UUID, previewKind } from "@/lib/file-rules"
import { openableFile } from "@/lib/files"
import { buildVtt } from "@/lib/ml"
import { langName, speechLines } from "@/lib/services/transcripts"
import { TEXT_SUBS, sidecarLabel, srtToVtt } from "@/lib/playback-rules"
import { appUrl } from "@/lib/email"
import { redis } from "@/lib/redis"
import { getText, presignGet } from "@/lib/s3"
import type { Me } from "@/lib/session"
import { signToken } from "@/lib/upload-rules"

const run = promisify(execFile)
const SIDECAR_MAX = 2 * 1024 ** 2

export type SubtitleTrack = {
  /** `s:<file id>` for a sidecar file, `e:<n>` for the n-th subtitle stream inside the video. */
  id: string
  label: string
  source: "sidecar" | "embedded" | "speech"
  /** Absolute, signed for the viewer for 12 hours: a TV can fetch it without signing in. Ask again to refresh. */
  url: string
}

// Track URLs carry a signed token (?t=), so Cast receivers can fetch them.
const trackUrl = (userId: string, id: string, track: string) =>
  `${appUrl()}/api/v1/files/${id}/subtitles/${encodeURIComponent(track)}?t=${signToken("subs", { u: userId, id, track }, 12 * 3600_000)}`

async function sidecars(me: Me, id: string, name: string) {
  const [self] = await db.select({ parentId: nodes.parentId, ownerId: nodes.ownerId }).from(nodes).where(eq(nodes.id, id))
  if (!self) return []
  const sibs = await db
    .select({ id: nodes.id, name: nodes.name })
    .from(nodes)
    .where(
      and(
        eq(nodes.ownerId, self.ownerId),
        self.parentId ? eq(nodes.parentId, self.parentId) : isNull(nodes.parentId),
        eq(nodes.kind, "file"),
        isNull(nodes.trashedAt),
        isNull(nodes.vaultId),
        sql`${nodes.name} ~* '\\.(srt|vtt)$'`
      )
    )
  const out: SubtitleTrack[] = []
  for (const s of sibs) {
    const label = sidecarLabel(name, s.name)
    // Only what I could open on its own: a shared video doesn't reveal its neighbours.
    if (label && (await accessOne(me.id, s.id))) out.push({ id: `s:${s.id}`, label, source: "sidecar", url: trackUrl(me.id, id, `s:${s.id}`) })
  }
  return out
}

type Stream = { codec_name?: string; tags?: { language?: string; title?: string } }

async function embedded(userId: string, id: string, url: string) {
  try {
    const { stdout } = await run(
      "ffprobe",
      ["-v", "error", "-select_streams", "s", "-show_entries", "stream=codec_name:stream_tags=language,title", "-of", "json", url],
      { timeout: 60_000 }
    )
    const streams: Stream[] = JSON.parse(stdout).streams ?? []
    // The index counts every subtitle stream, so picture tracks (PGS, DVD) leave gaps.
    return streams.flatMap((s, n): SubtitleTrack[] =>
      TEXT_SUBS.includes(s.codec_name ?? "")
        ? [{ id: `e:${n}`, label: s.tags?.title || s.tags?.language || `Track ${n + 1}`, source: "embedded", url: trackUrl(userId, id, `e:${n}`) }]
        : []
    )
  } catch {
    return [] // no ffprobe, or an unreadable file: just no embedded tracks
  }
}

// The auto transcript, when the worker made one with something in it.
async function speechTrack(userId: string, id: string, versionId: string | null): Promise<SubtitleTrack[]> {
  if (!versionId) return []
  const [r] = await db
    .select({ lang: nodeSpeech.lang })
    .from(nodeSpeech)
    .where(and(eq(nodeSpeech.nodeId, id), eq(nodeSpeech.versionId, versionId), eq(nodeSpeech.noSpeech, false), isNull(nodeSpeech.failed)))
  const name = langName(r?.lang ?? null)
  return r ? [{ id: "t:speech", label: name ? `Auto (${name})` : "Auto", source: "speech", url: trackUrl(userId, id, "t:speech") }] : []
}

// null: not a video or audio file I can open.
export async function subtitleTracks(me: Me, id: string, v?: string | null) {
  const file = await openableFile(me.id, id, v)
  if (!file || previewKind(file.mime, file.name) !== "video") return null
  const url = await presignGet(file.key, file.name, { expiresIn: 600 })
  return [...(await sidecars(me, id, file.name)), ...(await embedded(me.id, id, url)), ...(await speechTrack(me.id, id, file.versionId))]
}

// The track as WebVTT text, or null. Embedded tracks are cached for a day, since
// ffmpeg has to read through the file to find them.
export async function subtitleVtt(userId: string, id: string, track: string, v?: string | null) {
  const file = await openableFile(userId, id, v)
  if (!file) return null
  const [kind, ref] = track.split(":")
  if (kind === "t" && ref === "speech") {
    const lines = file.versionId ? await speechLines(id, file.versionId) : []
    return lines.length ? buildVtt(lines) : null
  }
  if (kind === "s" && UUID.test(ref ?? "")) {
    if (!(await accessOne(userId, ref))) return null
    const [s] = await db
      .select({ key: nodes.s3Key, name: nodes.name, size: nodes.size, vaultId: nodes.vaultId })
      .from(nodes)
      .where(eq(nodes.id, ref))
    if (!s?.key || s.vaultId || Number(s.size) > SIDECAR_MAX || !/\.(srt|vtt)$/i.test(s.name)) return null
    const text = await getText(s.key)
    return /\.vtt$/i.test(s.name) ? text : srtToVtt(text)
  }
  if (kind === "e" && /^\d{1,3}$/.test(ref ?? "")) {
    const cache = `subs:${file.key}:${ref}`
    const hit = await redis.get(cache).catch(() => null)
    if (hit) return hit
    const url = await presignGet(file.key, file.name, { expiresIn: 600 })
    try {
      const { stdout } = await run(
        "ffmpeg",
        ["-nostdin", "-v", "error", "-i", url, "-map", `0:s:${ref}`, "-f", "webvtt", "-"],
        { timeout: 5 * 60_000, maxBuffer: 20 * 1024 ** 2 }
      )
      await redis.set(cache, stdout, "EX", 86400).catch(() => {})
      return stdout
    } catch {
      return null
    }
  }
  return null
}
