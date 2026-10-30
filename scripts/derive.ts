// Thumbnails and search text for files no browser handled: WebDAV and API
// uploads queue a "derive" job (lib/redis.ts enqueueDerive), and the minute
// sweep catches the rest. Runs in npm run worker, beside the indexer.
import { isJunk, previewKind } from "../lib/file-rules.ts"
import { MAX_BODY } from "../lib/extract.ts"
import { saveThumb } from "../lib/thumb-store.ts"
import { serverThumb, serverThumbable } from "../lib/thumbs-server.ts"
import { indexFile, read, sql, type IndexFile } from "./indexer.ts"

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
