// Thumbnails and search text for files no browser handled: WebDAV and API
// uploads queue a "derive" job (lib/redis.ts enqueueDerive), and the minute
// sweep catches the rest. Runs in npm run worker, beside the indexer.
import sharp from "sharp"

import { exifTakenAt } from "../lib/exif.ts"
import {
  IMAGE,
  MEDIA_MIME_RE,
  MEDIA_NAME_RE,
  NOT_MEDIA_NAME_RE,
  isJunk,
  previewKind,
} from "../lib/file-rules.ts"
import { MAX_BODY } from "../lib/extract.ts"
import { saveThumb } from "../lib/thumb-store.ts"
import { serverThumb, serverThumbable } from "../lib/thumbs-server.ts"
import { indexFile, read, sha256Of, sql, type IndexFile } from "./indexer.ts"

type Row = IndexFile & { thumb: string | null; indexed: boolean }

// Current, untrashed, outside vaults; the node mirrors its current version.
const files = () => sql`
  select n.id, n.current_version_id as v, n.name, n.mime, n.size, n.s3_key as key,
    v.thumb, c.node_id is not null as indexed
  from nodes n
  join file_versions v on v.id = n.current_version_id
  left join node_content c on c.node_id = n.id and c.version_id = n.current_version_id
  where n.kind = 'file' and n.trashed_at is null and n.vault_id is null`

const limits = () =>
  sql<{ max: string; langs: string }[]>`
    select derive_max_bytes as max, ocr_langs as langs from settings`

// Skips anything a browser already did: a thumbnail that's no longer null, or text.
async function deriveRow(f: Row, langs: string) {
  const kind = previewKind(f.mime, f.name)
  const thumb = f.thumb === null && serverThumbable(kind)
  if (!thumb && f.indexed) return
  const size = Number(f.size)
  // Text needs only its start; images and PDFs are read whole.
  const end =
    kind === "text" || kind === "markdown" || kind === "csv"
      ? Math.min(size, MAX_BODY * 4)
      : size
  const bytes = end
    ? await read(f.key, end).catch(async (e: Error) => {
        // Gone from the bucket: give up, or the sweep retries it forever.
        if (e.name === "NoSuchKey" && thumb) await saveThumb(sql, f.key, null)
        throw e
      })
    : new Uint8Array()
  if (thumb) await saveThumb(sql, f.key, await serverThumb(bytes, kind!))
  if (!f.indexed) await indexFile(f, langs, bytes)
}

export async function derive(versionId: string) {
  const [{ max, langs }] = await limits()
  const [f] = await sql<
    Row[]
  >`${files()} and n.current_version_id = ${versionId}`
  if (!f || isJunk(f.name) || Number(f.size) > Number(max)) return
  await deriveRow(f, langs)
}

// Up to 5 thumbnails a minute that neither a browser nor a job made (files from
// before this, a job that gave up). Two minutes old, so a browser uploading it
// gets there first.
// ponytail: rescans every video and audio file each run; filter by kind in SQL if that gets slow.
export async function deriveMisses() {
  const [{ max, langs }] = await limits()
  const rows = await sql<Row[]>`${files()}
    and v.thumb is null and n.size <= ${max}
    and v.created_at < now() - interval '2 minutes'
    order by n.updated_at desc`
  const todo = rows
    .filter(
      (f) => !isJunk(f.name) && serverThumbable(previewKind(f.mime, f.name))
    )
    .slice(0, 5)
  for (const f of todo)
    await deriveRow(f, langs).catch((e: Error) =>
      console.error(`${f.name}: ${e.message}`)
    )
  return todo.length
}

// The date taken of up to 50 photo and video versions a sweep, newest first: new
// uploads within a minute, and the whole library over time (the backfill). Always
// sets taken_at, to the EXIF date or else the upload time, so a version is read once.
// Videos have no EXIF; they keep the upload time.
// ponytail: only the first 512 KB is read, so an EXIF block placed later is missed.
export async function exifMisses() {
  const rows = await sql<
    { id: string; key: string; name: string; size: string; created: Date }[]
  >`select v.id, v.s3_key as key, n.name, v.size, v.created_at as created
    from file_versions v join nodes n on n.id = v.node_id
    where v.taken_at is null and v.enc_key is null and n.vault_id is null
      and (n.name ~* ${MEDIA_NAME_RE}
        or (v.mime ~ ${MEDIA_MIME_RE} and n.name !~* ${NOT_MEDIA_NAME_RE}))
    order by v.created_at desc limit 50`
  for (const f of rows) {
    let taken: Date | null = null
    if (IMAGE.test(f.name) && Number(f.size) > 0) {
      try {
        const head = await read(f.key, Math.min(Number(f.size), 512 * 1024))
        const exif = (await sharp(head, { limitInputPixels: false }).metadata()).exif
        taken = exif ? exifTakenAt(exif) : null
      } catch (e) {
        // Gone from the bucket or not readable as an image: keep the upload time.
        // Anything else (S3 down) tries again next sweep.
        const err = e as Error
        if (err.name !== "NoSuchKey" && !/^Input|unsupported|corrupt/i.test(err.message)) {
          console.error(`${f.name}: ${err.message}`)
          continue
        }
      }
    }
    await sql`update file_versions set taken_at = ${taken ?? f.created} where id = ${f.id}`
  }
  return rows.length
}

// Versions saved without a hash (only the browser and the app's uploader send one) get it here,
// so folder sync and skip-by-hash can tell when a file really changed.
// ponytail: a version whose object is gone is skipped until restart, then tried once more.
const unhashable = new Set<string>()
export async function hashMisses() {
  const rows = await sql<{ id: string; key: string }[]>`
    select v.id, v.s3_key as key from file_versions v join nodes n on n.id = v.node_id
    where v.sha256 is null and v.enc_key is null and n.vault_id is null
      and not (v.id = any(${[...unhashable]}::uuid[]))
    order by v.created_at desc limit 20`
  for (const v of rows) {
    try {
      await sql`update file_versions set sha256 = ${await sha256Of(v.key)} where id = ${v.id} and sha256 is null`
    } catch (e) {
      const err = e as Error
      if (err.name === "NoSuchKey") unhashable.add(v.id)
      else console.error(`hash ${v.id}: ${err.message}`)
    }
  }
  return rows.length
}
