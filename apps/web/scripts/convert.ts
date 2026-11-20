// Media Converter: runs one convert_jobs row (video, audio or image) in npm run worker, with a nice'd ffmpeg or sharp.
// Reads the original through a presigned URL, writes the result to the bucket, then asks the app to save it as a file next to the
// original (lib/convert/store.ts, via /api/jobs). Progress comes from ffmpeg's -progress pipe; cancelling is the row's status changing.
import { execFile, spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { extname, join } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { promisify } from "node:util"
import sharp from "sharp"

import { ffmpegArgs, extOf, HEIC, mimeOf, outSeconds, progressOf, type Hw, type Preset } from "../lib/convert/rules.ts"
import { presignGet, putStream } from "../lib/s3.ts"
import { signToken } from "../lib/upload-rules.ts"
import { sql } from "./indexer.ts"

const run = promisify(execFile)
const app = process.env.BETTER_AUTH_URL ?? "http://localhost:3000"

class Cancelled extends Error {}
// A reason the member can act on; anything else is shown as a generic failure.
class Failure extends Error {}

type Row = { id: string; userId: string; status: string; preset: Preset; presetName: string; name: string | null; key: string | null }

const post = async (name: string, data: object) => {
  const res = await fetch(`${app}/api/jobs`, {
    method: "POST",
    headers: { Authorization: `Bearer ${signToken("job", {}, 60_000)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, data }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`The app answered ${res.status}.`)
}

async function duration(url: string) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", url], { timeout: 5 * 60_000 })
  const n = parseFloat(stdout)
  return Number.isFinite(n) && n > 0 ? n : null
}

function ffmpeg(args: string[], jobId: string, total: number) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn("nice", ["-n", "19", "ffmpeg", ...args], { stdio: ["ignore", "pipe", "pipe"] })
    let err = ""
    let buf = ""
    let block: Record<string, string> = {}
    let last = 0
    let stopped = false
    const tick = async () => {
      const pr = progressOf(block, total)
      if (!pr) return
      const r = await sql`update convert_jobs set progress = ${pr.pct}, eta_sec = ${pr.eta} where id = ${jobId} and status = 'running' returning id`
      if (!r.length && !stopped) {
        stopped = true
        p.kill("SIGKILL")
      }
    }
    p.stderr.on("data", (c) => (err = (err + c).slice(-600)))
    p.stdout.on("data", (c) => {
      buf += c
      const lines = buf.split("\n")
      buf = lines.pop()!
      for (const l of lines) {
        const i = l.indexOf("=")
        if (i < 0) continue
        block[l.slice(0, i)] = l.slice(i + 1)
        if (l.startsWith("progress=")) {
          if (Date.now() - last > 1000) {
            last = Date.now()
            tick().catch(() => {})
          }
          block = {}
        }
      }
    })
    p.on("error", reject)
    p.on("close", (code) =>
      stopped ? reject(new Cancelled()) : code === 0 ? resolve() : reject(new Error(err.trim().split("\n").pop() || `ffmpeg stopped with code ${code}.`))
    )
  })
}

async function image(url: string, name: string, p: Extract<Preset, { kind: "image" }>, dir: string, out: string) {
  const file = join(dir, `in${extname(name)}`)
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`Couldn't read the original (${res.status}).`)
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(file))
  let src = file
  if (HEIC.test(name)) {
    // The prebuilt sharp can't read HEIC (patent-encumbered HEVC), so libheif's heif-convert makes a JPG first.
    src = join(dir, "heic.jpg")
    await run("heif-convert", ["-q", "95", file, src]).catch((e: NodeJS.ErrnoException) => {
      throw e.code === "ENOENT" ? new Failure("HEIC photos need heif-convert (libheif-examples) on the server.") : e
    })
  }
  let s = sharp(src).rotate()
  if (p.maxSide) s = s.resize({ width: p.maxSide, height: p.maxSide, fit: "inside", withoutEnlargement: true })
  if (p.format === "jpg") s = s.flatten({ background: "#ffffff" }).jpeg({ quality: p.quality, mozjpeg: true })
  else if (p.format === "png") s = s.png({ compressionLevel: 9 })
  else if (p.format === "webp") s = s.webp({ quality: p.quality })
  else s = s.avif({ quality: p.quality })
  await s.toFile(out)
}

export async function convert(jobId: string) {
  const [j] = await sql<Row[]>`
    select j.id, j.user_id as "userId", j.status, j.preset, j.preset_name as "presetName", n.name, n.s3_key as key
    from convert_jobs j left join nodes n on n.id = j.input_node_id where j.id = ${jobId}`
  if (!j || j.status !== "queued") return
  const [s] = await sql<{ on: boolean; maxSeconds: number | null; daily: number; hw: Hw }[]>`
    select convert_tool_enabled as on, convert_max_seconds as "maxSeconds", convert_daily_minutes as daily, convert_hwaccel as hw from settings`
  // Cancelled between the queue and here: the row is no longer queued.
  const claimed = await sql`update convert_jobs set status = 'running', started_at = now(), progress = 0 where id = ${jobId} and status = 'queued' returning id`
  if (!claimed.length) return
  const dir = await mkdtemp(join(tmpdir(), "nimbus-convert-"))
  try {
    if (!s.on) throw new Failure("The Media Converter is turned off.")
    if (!j.name || !j.key) throw new Failure("The original file is gone.")
    const p = j.preset
    const url = await presignGet(j.key, j.name, { expiresIn: 12 * 3600 })
    const out = join(dir, `out.${extOf(p)}`)
    if (p.kind === "image") await image(url, j.name, p, dir, out)
    else {
      const length = await duration(url).catch(() => null)
      if (!length) throw new Failure("Couldn't read this file. Is it a valid video or audio file?")
      if (s.maxSeconds && length > s.maxSeconds) throw new Failure(`Longer than the ${Math.round(s.maxSeconds / 60)} minute limit for conversions.`)
      const total = outSeconds(p, length)
      if (s.daily > 0) {
        const [{ n }] = await sql<{ n: number }[]>`
          select coalesce(sum(seconds), 0)::int as n from convert_jobs
          where user_id = ${j.userId} and id <> ${jobId} and created_at >= date_trunc('day', now()) and status in ('queued', 'running', 'done')`
        if (n + total > s.daily * 60) throw new Failure(`That would pass your ${s.daily} minutes of conversion for today (${Math.ceil(n / 60)} used). It resets at midnight.`)
      }
      await sql`update convert_jobs set seconds = ${Math.ceil(total)} where id = ${jobId}`
      const go = (hw: Hw) => ffmpeg(ffmpegArgs(p, { input: url, out, duration: length, hw }), jobId, total)
      // Hardware encoding is the admin's choice for video; if it fails (no device, a codec the card lacks) software takes over.
      if (p.kind === "video" && s.hw !== "off")
        await go(s.hw).catch((e) => {
          if (e instanceof Cancelled) throw e
          return go("off")
        })
      else await go("off")
    }
    const size = (await stat(out)).size
    if (!size) throw new Failure("The conversion made an empty file.")
    const key = `convert-${randomBytes(16).toString("hex")}`
    await putStream(key, Readable.toWeb(createReadStream(out)) as ReadableStream<Uint8Array>, mimeOf(p))
    await post("convert-finish", { jobId, key, size })
  } catch (e) {
    if (e instanceof Cancelled) return
    const error = (e instanceof Failure ? e.message : `Conversion failed: ${(e as Error).message}`).slice(0, 300)
    await post("convert-fail", { jobId, error }).catch(
      () => sql`update convert_jobs set status = 'failed', error = ${error}, finished_at = now(), eta_sec = null where id = ${jobId} and status = 'running'`
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// A worker that died mid-conversion leaves jobs 'running' that no process owns.
export const convertBoot = () =>
  sql`update convert_jobs set status = 'failed', error = 'The worker restarted. Convert it again.', finished_at = now(), eta_sec = null where status = 'running'`
