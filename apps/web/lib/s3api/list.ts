// ListObjects v1 and v2 over the folder tree. Keys sort bytewise (Postgres
// collate "C"), which is the order S3 clients expect.
import "server-only"

import { sql } from "drizzle-orm"

import { db } from "@/lib/db"

import { enqueueBucketEtags, etagOf } from "./etags.ts"
import { xml, type C } from "./http.ts"
import { walk, type Bucket } from "./resolve.ts"
import { encodeKey, isoDate, S3Error, tag } from "./xml.ts"

type Entry = { key: string; folder: boolean; size: number; etag: string | null; versionId: string | null; at: Date }

// Up to `limit` entries with a key above `after` that start with `prefix`,
// in key order. With `flat`, every file under the prefix and every empty
// folder as "path/"; otherwise only the direct children (folders as "path/").
async function entries(b: Bucket, prefix: string, after: string, limit: number, flat: boolean): Promise<Entry[]> {
  const slash = prefix.lastIndexOf("/")
  const dir = prefix.slice(0, slash + 1)
  const rest = prefix.slice(slash + 1)
  const names = dir ? dir.slice(0, -1).split("/") : []
  if (names.some((n) => !n)) return []
  const { folder, missing } = await walk(b, names)
  if (missing) return []
  const owner = b.ownerId
  type Row = { key: string; kind: "file" | "folder"; size: string; etag: string | null; vid: string | null; at: Date }
  const rows = flat
    ? await db.execute<Row>(sql`
        with recursive t as (
          select n.id, n.kind, ${dir}::text || n.name as path, n.size, n.current_version_id, n.updated_at
          from nodes n where n.owner_id = ${owner} and n.parent_id = ${folder}
            and n.trashed_at is null and n.vault_id is null
          union all
          select c.id, c.kind, t.path || '/' || c.name, c.size, c.current_version_id, c.updated_at
          from t join nodes c on c.parent_id = t.id
          where t.kind = 'folder' and c.trashed_at is null and c.vault_id is null
            and (starts_with(${prefix}::text, t.path || '/') or starts_with(t.path || '/', ${prefix}::text))
        )
        select * from (select case when t.kind = 'folder' then t.path || '/' else t.path end as key,
          t.kind, t.size::text, v.etag, v.id as vid, coalesce(v.created_at, t.updated_at) as at
        from t left join file_versions v on v.id = t.current_version_id
        where starts_with(case when t.kind = 'folder' then t.path || '/' else t.path end, ${prefix}::text)
          and (case when t.kind = 'folder' then t.path || '/' else t.path end) collate "C" > ${after}::text collate "C"
          and (t.kind = 'file' or not exists (
            select 1 from nodes k where k.parent_id = t.id and k.trashed_at is null and k.vault_id is null))) q
        order by key collate "C" limit ${limit}`)
    : await db.execute<Row>(sql`
        select * from (select ${dir}::text || n.name || case when n.kind = 'folder' then '/' else '' end as key,
          n.kind, n.size::text, v.etag, v.id as vid, coalesce(v.created_at, n.updated_at) as at
        from nodes n left join file_versions v on v.id = n.current_version_id
        where n.owner_id = ${owner} and n.parent_id = ${folder}
          and n.trashed_at is null and n.vault_id is null
          and starts_with(n.name, ${rest}::text)
          and (${dir}::text || n.name || case when n.kind = 'folder' then '/' else '' end) collate "C" > ${after}::text collate "C") q
        order by key collate "C" limit ${limit}`)
  return rows.map((r) => ({
    key: r.key,
    folder: r.kind === "folder",
    size: r.kind === "folder" ? 0 : Number(r.size),
    etag: r.etag,
    versionId: r.vid,
    at: new Date(r.at),
  }))
}

// ListObjects (v1) and ListObjectsV2: the shared work.
export async function list(c: C, b: Bucket, v2: boolean) {
  const q = c.q
  const prefix = q.get("prefix") ?? ""
  const delimiter = q.get("delimiter") ?? ""
  const maxRaw = q.get("max-keys")
  const max = maxRaw === null ? 1000 : Number(maxRaw)
  if (!Number.isInteger(max) || max < 0) throw new S3Error("InvalidArgument", "Argument maxKeys must be an integer between 0 and 2147483647", 400)
  const limit = Math.min(max, 1000)
  const token = v2 ? q.get("continuation-token") : null
  let after = ""
  if (v2) after = token ? Buffer.from(token, "base64").toString("utf8") : (q.get("start-after") ?? "")
  else after = q.get("marker") ?? ""
  const url = q.get("encoding-type") === "url"
  const e = (k: string) => encodeKey(k, url)

  // The page: entries (files and rolled-up prefixes) in key order, one past
  // the limit to know whether there's more.
  const out: { key: string; prefix: boolean; e?: Entry }[] = []
  let truncated = false
  if (limit === 0) {
    // nothing to list
  } else if (delimiter === "/" || !delimiter) {
    const got = await entries(b, prefix, after, limit + 1, !delimiter)
    for (const x of got) out.push({ key: x.key, prefix: delimiter === "/" && x.folder, e: x })
    if (out.length > limit) {
      truncated = true
      out.length = limit
    }
  } else {
    // ponytail: a delimiter other than "/" scans every key under the prefix; only "/" is cheap.
    let cursor = after
    let last = ""
    scan: for (;;) {
      const got = await entries(b, prefix, cursor, 1000, true)
      for (const x of got) {
        cursor = x.key
        const i = x.key.indexOf(delimiter, prefix.length)
        const key = i < 0 ? x.key : x.key.slice(0, i + delimiter.length)
        if (i >= 0 && key === last) continue
        if (out.length === limit) {
          truncated = true
          break scan
        }
        last = i >= 0 ? key : ""
        out.push({ key, prefix: i >= 0, e: x })
      }
      if (got.length < 1000) break
    }
  }

  const files = out.filter((o) => !o.prefix)
  if (files.some((o) => o.e && !o.e.folder && !o.e.etag)) await enqueueBucketEtags(b.nodeId)
  const owner = c.who.userId
  const ownerXml = `<Owner>${tag("ID", owner)}${tag("DisplayName", owner)}</Owner>`
  const withOwner = !v2 || q.get("fetch-owner") === "true"
  const contents = files
    .map(
      (o) =>
        `<Contents>${tag("Key", e(o.key))}${tag("LastModified", isoDate(o.e!.at))}${tag("ETag", `"${o.e!.folder ? "d41d8cd98f00b204e9800998ecf8427e" : etagOf({ id: o.e!.versionId ?? "", etag: o.e!.etag })}"`)}${tag("Size", o.e!.size)}${tag("StorageClass", "STANDARD")}${withOwner ? ownerXml : ""}</Contents>`
    )
    .join("")
  const prefixes = out
    .filter((o) => o.prefix)
    .map((o) => `<CommonPrefixes>${tag("Prefix", e(o.key))}</CommonPrefixes>`)
    .join("")
  const lastKey = out.at(-1)?.key
  const common = `${tag("MaxKeys", max)}${delimiter ? tag("Delimiter", e(delimiter)) : ""}${url ? tag("EncodingType", "url") : ""}${tag("IsTruncated", truncated)}${contents}${prefixes}`
  const head = `${tag("Name", b.name)}${tag("Prefix", e(prefix))}`
  if (v2) {
    const start = q.get("start-after")
    return xml(
      c,
      "ListBucketResult",
      `${head}${tag("KeyCount", out.length)}${token ? tag("ContinuationToken", token) : ""}${start ? tag("StartAfter", e(start)) : ""}${truncated && lastKey ? tag("NextContinuationToken", Buffer.from(lastKey).toString("base64")) : ""}${common}`
    )
  }
  return xml(
    c,
    "ListBucketResult",
    `${head}${tag("Marker", e(after))}${truncated && delimiter && lastKey ? tag("NextMarker", e(lastKey)) : ""}${common}`
  )
}
