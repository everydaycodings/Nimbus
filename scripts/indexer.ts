// Optional: reads the text of files nobody has opened in a browser since they
// were uploaded (by the API, before search existed, from a phone that skipped
// OCR), so search finds them too. The browser does the same work lazily.
// Run: npm run indexer          (one sweep)
//      npm run indexer -- --watch  (sweep every minute)
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3"
import postgres from "postgres"

import { extractText, MAX_BODY, sourceOf, tooBig } from "../lib/extract.ts"
import { previewKind } from "../lib/file-rules.ts"
import { INDEXER_KEY, redis } from "../lib/redis.ts"

const env = process.env
const sql = postgres(env.DATABASE_URL!)
const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT || undefined,
  region: env.S3_REGION || "us-east-1",
  forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
  credentials: env.S3_ACCESS_KEY
    ? { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY! }
    : undefined,
})

// Files with no text to read, so later sweeps don't look at them again.
// ponytail: forgotten on restart; costs one cheap row scan per sweep.
const skip = new Set<string>()

async function read(key: string, end: number) {
  const r = await s3.send(
    new GetObjectCommand({
      Bucket: env.S3_BUCKET!,
      Key: key,
      Range: `bytes=0-${end - 1}`,
    })
  )
  return r.Body!.transformToByteArray()
}

async function sweep() {
  const [{ langs }] = await sql`select ocr_langs as langs from settings`
  const rows = await sql<
    {
      id: string
      v: string
      name: string
      mime: string | null
      size: string
      key: string
    }[]
  >`
    select n.id, n.current_version_id as v, n.name, n.mime, n.size, n.s3_key as key
    from nodes n
    left join node_content c on c.node_id = n.id and c.version_id = n.current_version_id
    where n.kind = 'file' and n.current_version_id is not null
      and n.trashed_at is null and n.vault_id is null and c.node_id is null
    order by n.updated_at desc`
  let done = 0
  for (const f of rows) {
    if (skip.has(f.v)) continue
    const source = sourceOf(previewKind(f.mime, f.name))
    const size = Number(f.size)
    if (!source || tooBig(source, size)) {
      skip.add(f.v)
      continue
    }
    const end = Math.min(size, source === "text" ? MAX_BODY * 4 : size)
    let body = ""
    try {
      if (end) {
        const bytes = await read(f.key, end)
        body = await extractText(bytes, source, langs).catch((e: Error) => {
          console.error(`${f.name}: unreadable (${e.message})`)
          return ""
        })
      }
    } catch (e) {
      console.error(`${f.name}: ${(e as Error).message}`)
      skip.add(f.v)
      continue
    }
    // The version may have changed while we read; then the browser or the next sweep has it.
    await sql`
      insert into node_content (node_id, version_id, body, source)
      select ${f.id}, ${f.v}, ${body}, ${source}
      where exists (select 1 from nodes where id = ${f.id} and current_version_id = ${f.v})
      on conflict (node_id) do update set
        version_id = excluded.version_id, body = excluded.body,
        source = excluded.source, indexed_at = now()`
    done++
    console.log(`${source.padEnd(5)} ${f.name} (${body.length} chars)`)
  }
  return done
}

if (process.argv.includes("--watch")) {
  for (;;) {
    await sweep()
    // Admin → Health shows the indexer as running while this key lives.
    await redis.set(INDEXER_KEY, Date.now(), "PX", 3 * 60_000).catch(() => {})
    await new Promise((r) => setTimeout(r, 60_000))
  }
} else {
  console.log(`Indexed ${await sweep()} files.`)
  await sql.end()
  process.exit(0)
}
