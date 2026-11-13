// Reads the text of every file (documents, PDFs, images, video frames) into
// node_content and node_text_parts, so search finds words and says where.
// `npm run worker` sweeps every minute.
// Run: npm run indexer   (one sweep)
import { createHash } from "node:crypto"
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3"
import postgres from "postgres"

import {
  extractParts,
  MAX_BODY,
  ocrAllows,
  sourceOf,
  tooBig,
  type OcrMode,
  type Part,
} from "../lib/extract.ts"
import { previewKind } from "../lib/file-rules.ts"
import { deriveQueue, transcodeQueue } from "../lib/redis.ts"
import { presignGet } from "../lib/s3.ts"
import { ocrGroups } from "@nimbus/shared/smart-groups"
import { videoParts } from "./video-ocr.ts"

const env = process.env
export const sql = postgres(env.DATABASE_URL!)
const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT || undefined,
  region: env.S3_REGION || "us-east-1",
  forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
  credentials: env.S3_ACCESS_KEY
    ? { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY! }
    : undefined,
})

// SHA-256 of the whole object, streamed.
export async function sha256Of(key: string) {
  const r = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET!, Key: key }))
  const h = createHash("sha256")
  for await (const chunk of r.Body as AsyncIterable<Uint8Array>) h.update(chunk)
  return h.digest("hex")
}

export async function read(key: string, end: number) {
  const r = await s3.send(
    new GetObjectCommand({
      Bucket: env.S3_BUCKET!,
      Key: key,
      Range: `bytes=0-${end - 1}`,
    })
  )
  return r.Body!.transformToByteArray()
}

export type IndexFile = {
  id: string
  v: string
  name: string
  mime: string | null
  size: string
  key: string
}

// What the Health page's indexer card shows, written by the worker after each sweep.
export const status = { ocrBacklog: 0, ocrFailed: 0, lastError: null as string | null }

const settings = async () =>
  (
    await sql<{ mode: OcrMode; langs: string; videoMin: number }[]>`
      select ocr_mode as mode, ocr_langs as langs, ocr_video_max_min as "videoMin" from settings`
  )[0]

// Reads one version's text into node_content and node_text_parts. False when
// the mode skips it, or on a trouble that may pass (storage down), so a later
// sweep tries again. Files that can't be read are saved with ocr_failed, which
// no sweep retries until the languages change or someone asks. `bytes`: the
// whole file, already read.
export async function indexFile(f: IndexFile, bytes?: Uint8Array) {
  const kind = previewKind(f.mime, f.name)
  const video = kind === "video"
  const source = video ? "ocr" : sourceOf(kind)
  const { mode, langs, videoMin } = await settings()
  const size = Number(f.size)
  // PDFs and plain documents still give their text when OCR is off.
  if (!source || ((kind === "image" || video) && !ocrAllows(mode, kind))) return false
  let body = ""
  let parts: Part[] = []
  let ocr: string | null = null
  let failed: string | null = null
  if (!video && tooBig(source, size)) failed = "Too big to read."
  else
    try {
      if (video) {
        parts = await videoParts(await presignGet(f.key, f.name, { expiresIn: 12 * 3600 }), langs, videoMin)
        body = parts.map((p) => p.body).join("\n").slice(0, MAX_BODY)
        ocr = langs
      } else if (size) {
        const end = source === "text" ? Math.min(size, MAX_BODY * 4) : size
        bytes ??= await read(f.key, end)
        try {
          ;({ body, parts, ocr } = await extractParts(bytes, source, langs, ocrAllows(mode, "pdf")))
        } catch (e) {
          failed = (e as Error).message || "Couldn't be read."
          console.error(`${f.name}: unreadable (${failed})`)
        }
      }
    } catch (e) {
      const err = e as Error
      console.error(`${f.name}: ${err.message}`)
      status.lastError = `${f.name}: ${err.message}`
      // Gone from the bucket: nothing to retry. Anything else may pass.
      // (ffmpeg reads videos by URL, so for them "gone" is an HTTP 404.)
      if (err.name !== "NoSuchKey" && !/404 Not Found/.test(err.message)) return false
      failed = "The file is gone from storage."
    }
  // A failed image or video is read again only after a language change.
  if (failed && (kind === "image" || video)) ocr = langs
  // The version may have changed while we read; then the next sweep has it.
  const saved = await sql.begin(async (tx) => {
    const [row] = await tx`
      insert into node_content (node_id, version_id, body, source, ocr_langs, ocr_failed)
      select ${f.id}, ${f.v}, ${body}, ${source}, ${ocr}, ${failed}
      where exists (select 1 from nodes where id = ${f.id} and current_version_id = ${f.v})
      on conflict (node_id) do update set
        version_id = excluded.version_id, body = excluded.body, source = excluded.source,
        ocr_langs = excluded.ocr_langs, ocr_failed = excluded.ocr_failed, indexed_at = now()
      returning node_id`
    if (!row) return false
    await tx`delete from node_text_parts where node_id = ${f.id} and source = 'ocr'`
    for (let i = 0; i < parts.length; i += 500)
      await tx`insert into node_text_parts ${tx(
        parts.slice(i, i + 500).map((p) => ({
          node_id: f.id,
          version_id: f.v,
          kind: p.kind,
          page: p.page ?? null,
          t_ms: p.tMs ?? null,
          box: p.box ? tx.json(p.box) : null,
          body: p.body,
        }))
      )}`
    return true
  })
  if (!saved) return false
  // Photos the name rules couldn't place: receipts and documents show by their words.
  // (exifMisses does the same when it runs after this.)
  if (kind === "image" && !failed)
    await sql`update file_versions set smart = ${ocrGroups(body)}::text[]
      where id = ${f.v} and smart is null and gps_checked`
  console.log(`${(video ? "video" : source).padEnd(5)} ${f.name} (${body.length} chars, ${parts.length} parts)`)
  return true
}

export const busy = async () =>
  (await Promise.all([deriveQueue.getActiveCount(), transcodeQueue.getActiveCount()])).some((n) => n > 0)

// A few files a minute, so the worker's CPU stays free for uploads: up to 50
// plain documents, 3 images or PDFs and 1 video; none of the OCR ones while a
// thumbnail or video copy is being made.
// ponytail: a long video holds up the rest of the sweep; run OCR in its own loop if that bites.
export async function sweep() {
  const { mode, langs } = await settings()
  const rows = await sql<(IndexFile & { had: string | null })[]>`
    select n.id, n.current_version_id as v, n.name, n.mime, n.size, n.s3_key as key,
      c.ocr_langs as had
    from nodes n
    join file_versions fv on fv.id = n.current_version_id and fv.enc_key is null
    left join node_content c on c.node_id = n.id and c.version_id = n.current_version_id
    where n.kind = 'file' and n.trashed_at is null and n.vault_id is null
      and (c.node_id is null or (c.ocr_langs is not null and c.ocr_langs <> ${langs}))
    order by n.updated_at desc`
  const todo = rows.flatMap((f) => {
    const kind = previewKind(f.mime, f.name)
    const plain = sourceOf(kind) !== null && kind !== "image" && kind !== "pdf"
    // A re-read only helps when OCR is allowed for the kind now.
    const ok = plain || (f.had === null ? kind === "pdf" : false) || ocrAllows(mode, kind)
    return ok ? [{ f, kind, heavy: !plain }] : []
  })
  status.ocrBacklog = todo.filter((t) => t.heavy).length
  const wait = status.ocrBacklog > 0 && (await busy())
  const left = { plain: 50, heavy: 3, video: 1 }
  let done = 0
  for (const { f, kind, heavy } of todo) {
    const slot = !heavy ? "plain" : kind === "video" ? "video" : "heavy"
    if (heavy && wait) continue
    if (left[slot] <= 0) continue
    left[slot]--
    if (await indexFile(f)) done++
  }
  const [{ n }] = await sql`select count(*)::int as n from node_content where ocr_failed is not null`
  status.ocrFailed = n
  return done
}

// Run directly, not imported by the worker.
if (process.argv[1]?.endsWith("indexer.ts")) {
  console.log(`Indexed ${await sweep()} files.`)
  await sql.end()
  process.exit(0)
}
