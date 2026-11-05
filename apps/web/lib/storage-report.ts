import "server-only"

import { sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { user } from "@/lib/db/schema"
import { getPath, listFolder, listTrash, UUID } from "@/lib/files"
import { getUsage } from "@/lib/quota"

export type ReportRow = {
  id: string
  kind: "file" | "folder"
  name: string
  mime: string | null
  size: number
  // The folder it's in, "" at the top.
  parentId: string | null
  where: string
  // Old versions only: how many there are (kept-forever ones included).
  versions?: number
  keep?: number
}

export type Report = Awaited<ReturnType<typeof report>>

// What fills an account's storage, for /storage and the admin's view of it.
// Vault files are left out: their names are sealed. Old version bytes are
// distinct by S3 key, like getUsage(), so a restored copy isn't counted twice.
export async function report(ownerId: string, folderId: string | null) {
  const [usage, largest, old, trash, folder] = await Promise.all([
    getUsage(ownerId),
    db.execute<Omit<ReportRow, "where">>(sql`
      select id, kind, name, mime, size::float8 as size, parent_id as "parentId"
      from nodes
      where owner_id = ${ownerId} and kind = 'file'
        and trashed_at is null and vault_id is null
      order by size desc limit 50`),
    db.execute<Omit<ReportRow, "where">>(sql`
      select * from (
        select n.id, n.kind, n.name, n.mime, n.parent_id as "parentId",
          (select count(*)::int from file_versions v
            where v.node_id = n.id and v.id <> n.current_version_id) as versions,
          (select count(*)::int from file_versions v
            where v.node_id = n.id and v.id <> n.current_version_id and v.keep) as keep,
          (select coalesce(sum(size), 0)::float8 from (
            select distinct on (v.s3_key) v.size from file_versions v
            where v.node_id = n.id and v.id <> n.current_version_id
              and v.s3_key <> n.s3_key) k) as size
        from nodes n
        where n.owner_id = ${ownerId} and n.kind = 'file'
          and n.trashed_at is null and n.vault_id is null
      ) f
      where versions > 0
      order by size desc, versions desc limit 50`),
    listTrash(ownerId),
    folderId ? ownFolder(ownerId, folderId) : null,
  ])
  const trashBytes = trash.reduce((n, t) => n + t.size, 0)
  const top = [...trash].sort((a, b) => b.size - a.size).slice(0, 10)
  // Shortcuts to other people's things live in My files but aren't stored here.
  const kids = (await listFolder(ownerId, ownerId, folder?.id ?? null))
    .filter((k) => !k.shortcut)
    .sort((a, b) => b.size - a.size)
  const paths = await folderPaths([
    ...[...largest, ...old].flatMap((r) => (r.parentId ? [r.parentId] : [])),
  ])
  const placed = (r: Omit<ReportRow, "where">) => ({
    ...r,
    where: r.parentId ? (paths.get(r.parentId) ?? "") : "",
  })
  return {
    usage,
    largest: largest.map(placed),
    old: old.map(placed),
    trash: {
      bytes: trashBytes,
      count: trash.length,
      top: top.map((t) => ({
        id: t.id,
        kind: t.kind,
        name: t.name,
        mime: t.mime,
        size: t.size,
        parentId: null,
        where: "",
      })),
    },
    folder: {
      id: folder?.id ?? null,
      path: folder ? await getPath(folder.id) : [],
      bytes: kids.reduce((n, k) => n + k.size, 0),
      items: kids.map((k) => ({
        id: k.id,
        kind: k.kind,
        name: k.name,
        mime: k.mime,
        size: k.size,
        parentId: folder?.id ?? null,
        where: "",
      })),
    },
  }
}

// A folder of `ownerId`'s outside the trash and vaults, or null.
async function ownFolder(ownerId: string, id: string) {
  if (!UUID.test(id)) return null
  const [row] = await db.execute<{ id: string }>(sql`
    select id from nodes
    where id = ${id} and owner_id = ${ownerId} and kind = 'folder'
      and trashed_at is null and vault_id is null`)
  return row ?? null
}

// "Reports/2026" for each folder id, from the top down.
async function folderPaths(ids: string[]) {
  const unique = [...new Set(ids)]
  if (!unique.length) return new Map<string, string>()
  const rows = await db.execute<{ id: string; path: string }>(sql`
    with recursive up as (
      select id as start, parent_id, name, 0 as depth from nodes
      where id in ${unique}
      union all
      select up.start, n.parent_id, n.name, up.depth + 1
      from nodes n join up on n.id = up.parent_id
    )
    select start as id, string_agg(name, '/' order by depth desc) as path
    from up group by start`)
  return new Map(rows.map((r) => [r.id, r.path]))
}

// Every account's usage against its limit, fullest first, for /admin/storage/usage.
// ponytail: one getUsage() per account; fine for a team, add a single grouped query for thousands.
export async function instanceUsage() {
  const people = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      role: user.role,
    })
    .from(user)
  const rows = await Promise.all(
    people.map(async (p) => ({ ...p, usage: await getUsage(p.id) }))
  )
  const share = (r: (typeof rows)[number]) =>
    r.usage.quota ? r.usage.used / r.usage.quota : -1
  return rows.sort((a, b) => share(b) - share(a) || b.usage.used - a.usage.used)
}
