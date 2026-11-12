// Data-saver copies (720p and 480p H.264/AAC MP4) of videos, for Admin → Video copies.
// The minute sweep queues one video at a time (transcodeMisses, newest first, so new
// uploads come first and the library follows slowly); an owner's "make copy" queues one
// at once. Runs in npm run worker with a nice'd ffmpeg. Needs ffmpeg in the image.
import { execFile } from "node:child_process"
import { createReadStream } from "node:fs"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import { promisify } from "node:util"

import { isJunk, previewKind, VIDEO } from "../lib/file-rules.ts"
import { copyHeight, renditionKey, renditionsToMake } from "../lib/playback-rules.ts"
import { enqueueTranscode, transcodeQueue } from "../lib/redis.ts"
import { presignGet, putStream } from "../lib/s3.ts"
import { sql } from "./indexer.ts"

const run = promisify(execFile)
const HOURS = 3600_000

const settings = async () =>
  (
    await sql<{ on: boolean; cap: string | null }[]>`
      select video_copies as on, video_copy_cap_bytes as cap from settings`
  )[0]

const used = async () =>
  Number(
    (await sql`select coalesce(sum(size), 0) as n from video_renditions where status = 'done'`)[0].n
  )

const overCap = async (cap: string | null) => cap !== null && (await used()) >= Number(cap)

async function probe(url: string) {
  const { stdout } = await run(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,height", "-of", "json", url],
    { timeout: 5 * 60_000 }
  )
  const s = JSON.parse(stdout).streams?.[0]
  return s?.height ? { height: Number(s.height), codec: String(s.codec_name) } : null
}

// One copy, written to `out`. Audio is optional (a silent video is fine); subtitles are dropped.
export const encode = (url: string, height: number, out: string) =>
  run(
    "nice",
    [
      "-n", "19", "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", url,
      "-map", "0:v:0", "-map", "0:a:0?", "-vf", `scale=-2:${height}`,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-sn", "-dn", "-movflags", "+faststart", out,
    ],
    { timeout: 12 * HOURS }
  )

const mark = (nodeId: string, key: string, height: number, status: string, codec: string | null, file: string | null, size = 0) =>
  sql`insert into video_renditions (node_id, source_key, height, key, size, status, codec)
    values (${nodeId}, ${key}, ${height}, ${file}, ${size}, ${status}, ${codec})
    on conflict (source_key, height) do update
    set key = ${file}, size = ${size}, status = ${status}, codec = ${codec}`

export async function transcode(nodeId: string) {
  const s = await settings()
  if (!s.on) return
  const [f] = await sql<{ name: string; mime: string | null; key: string }[]>`
    select n.name, n.mime, n.s3_key as key
    from nodes n join file_versions v on v.id = n.current_version_id
    where n.id = ${nodeId} and n.kind = 'file' and n.vault_id is null and v.enc_key is null`
  if (!f || previewKind(f.mime, f.name) !== "video") return
  const done = new Set(
    (
      await sql<{ height: number }[]>`
        select height from video_renditions
        where source_key = ${f.key} and status in ('done', 'skipped')`
    ).map((r) => r.height)
  )
  const url = await presignGet(f.key, f.name, { expiresIn: 12 * 3600 })
  const info = await probe(url).catch(() => null)
  if (!info) {
    for (const q of [720, 480]) await mark(nodeId, f.key, q, "failed", null, null)
    throw new Error(`${f.name}: ffprobe found no video.`)
  }
  const make = renditionsToMake(info.height, info.codec)
  for (const q of [720, 480])
    if (!make.includes(q as 720) && !done.has(q))
      await mark(nodeId, f.key, q, "skipped", info.codec, null)
  const dir = await mkdtemp(join(tmpdir(), "nimbus-copy-"))
  try {
    for (const q of make) {
      if (done.has(q)) continue
      if (await overCap(s.cap)) {
        // Not marked, so raising the cap lets the sweep come back to it.
        await sql`delete from video_renditions where source_key = ${f.key} and status = 'pending'`
        return
      }
      await mark(nodeId, f.key, q, "pending", info.codec, null)
      const out = join(dir, `${q}.mp4`)
      try {
        await encode(url, copyHeight(q, info.height), out)
        await putStream(
          renditionKey(f.key, q),
          Readable.toWeb(createReadStream(out)) as ReadableStream<Uint8Array>,
          "video/mp4"
        )
        await mark(nodeId, f.key, q, "done", info.codec, renditionKey(f.key, q), (await stat(out)).size)
      } catch (e) {
        await mark(nodeId, f.key, q, "failed", info.codec, null)
        throw e
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// Each minute, when the queue is idle: the newest video with no copies tried yet.
// ponytail: looks at the 20 newest candidates only; a run of 20 non-videos named like videos hides older ones.
export async function transcodeMisses() {
  const s = await settings()
  if (!s.on || (await overCap(s.cap))) return 0
  const counts = await transcodeQueue.getJobCounts("waiting", "active", "delayed")
  if (Object.values(counts).some((n) => n > 0)) return 0
  const rows = await sql<{ id: string; name: string; mime: string | null }[]>`
    select n.id, n.name, n.mime
    from nodes n join file_versions v on v.id = n.current_version_id
    where n.kind = 'file' and n.trashed_at is null and n.vault_id is null and v.enc_key is null
      and (n.mime like 'video/%' or n.name ~* ${VIDEO.source})
      and not exists (select 1 from video_renditions r where r.source_key = n.s3_key)
    order by v.created_at desc limit 20`
  const next = rows.find((f) => !isJunk(f.name) && previewKind(f.mime, f.name) === "video")
  if (next) await enqueueTranscode(next.id)
  return next ? 1 : 0
}
