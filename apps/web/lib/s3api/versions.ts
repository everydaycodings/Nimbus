// Versioning over the file tree. A key's history is every version of every
// file that ever had that path: the live file's versions, and the versions of
// files in the trash, each trashed file standing for one delete marker
// ("dm-<node id>"). A version's id is its file_versions id.
import "server-only"

import { and, desc, eq, ne, sql } from "drizzle-orm"

import { recordOne } from "@/lib/activity"
import { db } from "@/lib/db"
import { fileVersions, nodes } from "@/lib/db/schema"
import { UUID } from "@/lib/files"
import { checkStorage } from "@/lib/quota"
import { restoreNode } from "@/lib/tree"
import { deleteNodes, deleteUnreferenced, isClash, mkdirp } from "@/lib/uploads"

import { etagOf } from "./etags.ts"
import { xml, type C } from "./http.ts"
import { mustWrite, pruneEmpty, versionOf, type Bucket } from "./resolve.ts"
import { encodeKey, isoDate, S3Error, tag } from "./xml.ts"

export type Item = {
  key: string
  id: string
  marker: boolean
  latest: boolean
  at: Date
  size: number
  etag: string
}

type Row = { key: string; node_id: string; trashed_at: Date | null; cur: string | null; vid: string; size: string; etag: string | null; created_at: Date }

const MARKER = "dm-"
export const markerId = (nodeId: string) => MARKER + nodeId

// Every version under `prefix` (exactly `prefix` when `exact`) for the next
// `keys` keys after `after` (from it, when `inclusive`), key order, newest
// version first. Trashed files and folders are walked too.
async function versionRows(b: Bucket, prefix: string, after: string, keys: number, o: { exact?: boolean; inclusive?: boolean } = {}) {
  return db.execute<Row>(sql`
    with recursive t as (
      select n.id, n.kind, n.name as path, n.trashed_at, n.current_version_id
      from nodes n where n.owner_id = ${b.ownerId} and n.parent_id = ${b.nodeId} and n.vault_id is null
      union all
      select c.id, c.kind, t.path || '/' || c.name, c.trashed_at, c.current_version_id
      from t join nodes c on c.parent_id = t.id
      where t.kind = 'folder' and c.vault_id is null
        and (starts_with(${prefix}::text, t.path || '/') or starts_with(t.path || '/', ${prefix}::text))
    ), k as (
      select path from (
        select distinct path from t
        where kind = 'file' and starts_with(path, ${prefix}::text)
          and (${!o.exact}::boolean or path = ${prefix}::text)
          and path collate "C" ${o.inclusive ? sql`>=` : sql`>`} ${after}::text collate "C"
      ) d order by path collate "C" limit ${keys})
    select t.path as key, t.id as node_id, t.trashed_at, t.current_version_id as cur,
      v.id as vid, v.size::text, v.etag, v.created_at
    from t join k on k.path = t.path join file_versions v on v.node_id = t.id
    where t.kind = 'file'
    order by t.path collate "C", v.number desc`)
}

// One key's history, newest first, with the latest marked: the live file's
// current version, else the most recent delete marker.
function itemsOf(rows: Row[]): Item[] {
  const live = rows.find((r) => !r.trashed_at)
  const items: Item[] = rows.map((r) => ({
    key: r.key, id: r.vid, marker: false, latest: false, at: new Date(r.created_at), size: Number(r.size), etag: etagOf({ id: r.vid, etag: r.etag }),
  }))
  for (const r of new Map(rows.filter((r) => r.trashed_at).map((r) => [r.node_id, r])).values())
    items.push({ key: r.key, id: markerId(r.node_id), marker: true, latest: false, at: new Date(r.trashed_at!), size: 0, etag: "" })
  items.sort((x, y) => y.at.getTime() - x.at.getTime() || Number(y.marker) - Number(x.marker))
  const latest = (live && items.find((i) => i.id === live.cur)) || items[0]
  if (latest) latest.latest = true
  return items
}

const groups = (rows: Row[]) => {
  const m = new Map<string, Row[]>()
  for (const r of rows) m.set(r.key, [...(m.get(r.key) ?? []), r])
  return m
}

// ListObjectVersions. Folder markers ("dir/") aren't listed.
export async function listVersions(c: C, b: Bucket) {
  const q = c.q
  const prefix = q.get("prefix") ?? ""
  const delimiter = q.get("delimiter") ?? ""
  const keyMarker = q.get("key-marker") ?? ""
  const idMarker = keyMarker ? (q.get("version-id-marker") ?? "") : ""
  const max = q.has("max-keys") ? Number(q.get("max-keys")) : 1000
  if (!Number.isInteger(max) || max < 0) throw new S3Error("InvalidArgument", "Argument maxKeys must be an integer between 0 and 2147483647", 400)
  const limit = Math.min(max, 1000)
  const url = q.get("encoding-type") === "url"
  const e = (k: string) => encodeKey(k, url)

  const out: ({ prefix: string } | Item)[] = []
  let truncated = false
  let after = keyMarker
  let inclusive = Boolean(idMarker)
  let lastPrefix = ""
  // ponytail: a key's page of versions is cut by walking the key batch; a bucket with
  // millions of keys under one delimiter-less prefix pages 1000 keys per query.
  scan: for (; limit > 0; ) {
    const rows = await versionRows(b, prefix, after, 1000, { inclusive })
    const byKey = groups(rows)
    for (const [key, krows] of byKey) {
      if (delimiter && keyMarker.endsWith(delimiter) && key.startsWith(keyMarker)) continue
      const i = delimiter ? key.indexOf(delimiter, prefix.length) : -1
      if (i >= 0) {
        const cp = key.slice(0, i + delimiter.length)
        if (cp === lastPrefix) continue
        if (out.length === limit) {
          truncated = true
          break scan
        }
        out.push({ prefix: cp })
        lastPrefix = cp
        continue
      }
      let items = itemsOf(krows)
      if (key === keyMarker) {
        const j = items.findIndex((x) => x.id === idMarker)
        items = idMarker && j >= 0 ? items.slice(j + 1) : []
      }
      for (const it of items) {
        if (out.length === limit) {
          truncated = true
          break scan
        }
        out.push(it)
      }
    }
    if (byKey.size < 1000) break
    after = [...byKey.keys()].at(-1)!
    inclusive = false
  }

  const last = out.at(-1)
  const owner = `<Owner>${tag("ID", c.who.userId)}${tag("DisplayName", c.who.userId)}</Owner>`
  const body = out
    .map((o) => {
      if ("prefix" in o) return `<CommonPrefixes>${tag("Prefix", e(o.prefix))}</CommonPrefixes>`
      const head = `${tag("Key", e(o.key))}${tag("VersionId", o.id)}${tag("IsLatest", o.latest)}${tag("LastModified", isoDate(o.at))}`
      return o.marker
        ? `<DeleteMarker>${head}${owner}</DeleteMarker>`
        : `<Version>${head}${tag("ETag", `"${o.etag}"`)}${tag("Size", o.size)}${tag("StorageClass", "STANDARD")}${owner}</Version>`
    })
    .join("")
  const next = !truncated || !last ? "" : "prefix" in last ? tag("NextKeyMarker", e(last.prefix)) : `${tag("NextKeyMarker", e(last.key))}${tag("NextVersionIdMarker", last.id)}`
  return xml(
    c,
    "ListVersionsResult",
    `${tag("Name", b.name)}${tag("Prefix", e(prefix))}${tag("KeyMarker", e(keyMarker))}${tag("VersionIdMarker", idMarker)}${next}${tag("MaxKeys", max)}${delimiter ? tag("Delimiter", e(delimiter)) : ""}${url ? tag("EncodingType", "url") : ""}${tag("IsTruncated", truncated)}${body}`
  )
}

// The names from the bucket down to a node, trashed folders included; null
// when the node isn't in this bucket.
async function pathParts(b: Bucket, nodeId: string) {
  const rows = await db.execute<{ id: string; name: string }>(sql`
    with recursive up as (
      select id, parent_id, name, 0 as depth from nodes where id = ${nodeId} and owner_id = ${b.ownerId} and vault_id is null
      union all
      select p.id, p.parent_id, p.name, up.depth + 1 from nodes p join up on p.id = up.parent_id
      where up.id <> ${b.nodeId}
    )
    select id, name from up order by depth desc`)
  if (rows[0]?.id !== b.nodeId) return null
  return rows.slice(1).map((r) => r.name)
}

const noVersion = () => new S3Error("NoSuchVersion", "The specified version does not exist.", 404)

// What a version id means for `key`: a delete marker (the trashed file) or a
// file version with its file.
export async function lookupVersion(b: Bucket, key: string, vid: string) {
  const isMarker = vid.startsWith(MARKER)
  const id = isMarker ? vid.slice(MARKER.length) : vid
  if (!UUID.test(id)) throw new S3Error("InvalidArgument", "Invalid version id specified", 400)
  const [node] = isMarker
    ? await db.select().from(nodes).where(eq(nodes.id, id))
    : await db.select({ n: nodes }).from(fileVersions).innerJoin(nodes, eq(nodes.id, fileVersions.nodeId)).where(eq(fileVersions.id, id)).then((r) => r.map((x) => x.n))
  if (!node || node.kind !== "file" || (isMarker && !node.trashedAt) || (await pathParts(b, node.id))?.join("/") !== key) throw noVersion()
  if (isMarker) return { marker: true as const, node }
  const v = await versionOf(vid)
  if (!v) throw noVersion()
  return { marker: false as const, node, v }
}

// The delete marker that is a key's latest entry, if its file is in the trash.
export async function latestMarker(b: Bucket, key: string) {
  const items = itemsOf([...(await versionRows(b, key, "", 1, { exact: true }))])
  const top = items.find((i) => i.latest)
  return top?.marker ? top.id : undefined
}

// DeleteObject with a versionId. A file version goes for good (the one before
// it becomes current if it was); a delete marker, when it's the latest, brings
// its file back out of the trash.
export async function removeVersion(c: C, b: Bucket, key: string, vid: string) {
  mustWrite(b)
  const found = await lookupVersion(b, key, vid)
  const { node } = found
  if (found.marker) {
    if ((await latestMarker(b, key)) !== vid)
      throw new S3Error("InvalidRequest", "Only the latest delete marker can be removed, and only while no live object has the key.", 409)
    const parts = (await pathParts(b, node.id))!
    try {
      await db.transaction(async (tx) => {
        // The folders may have been cleared away with the file, so make them again.
        const made = await mkdirp(tx, b.ownerId, b.nodeId, parts.slice(0, -1))
        if ("error" in made) throw new S3Error("InvalidRequest", made.error, 409)
        await tx.update(nodes).set({ parentId: made.id! }).where(eq(nodes.id, node.id))
        await restoreNode(tx, b.ownerId, node.id)
      })
    } catch (e) {
      if (isClash(e)) throw new S3Error("InvalidRequest", "An object with that key exists again, so the delete marker can't be removed.", 409)
      throw e
    }
    await recordOne(node.id, c.who.userId, "restore")
    return { versionId: vid, marker: true }
  }
  const { v } = found
  const last = await db.transaction(async (tx) => {
    await tx.execute(sql`select 1 from nodes where id = ${node.id} for update`)
    const [prev] = await tx
      .select({ id: fileVersions.id, s3Key: fileVersions.s3Key, size: fileVersions.size, mime: fileVersions.mime })
      .from(fileVersions)
      .where(and(eq(fileVersions.nodeId, node.id), ne(fileVersions.id, v.id)))
      .orderBy(desc(fileVersions.number))
      .limit(1)
    if (!prev) return true
    if (node.currentVersionId === v.id)
      await tx.update(nodes).set({ currentVersionId: prev.id, s3Key: prev.s3Key, size: prev.size, mime: prev.mime, updatedAt: new Date() }).where(eq(nodes.id, node.id))
    await tx.delete(fileVersions).where(eq(fileVersions.id, v.id))
    return false
  })
  if (last) {
    await deleteNodes(eq(nodes.id, node.id))
    await pruneEmpty(b, node.parentId)
  } else await deleteUnreferenced([v.s3Key])
  await checkStorage(b.ownerId)
  return { versionId: vid, marker: false }
}
