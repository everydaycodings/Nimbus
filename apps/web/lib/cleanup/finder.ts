// Clean up's lists. Only files the viewer owns, not in the trash, not in a Vault, current versions only.
import "server-only"

import { sql, type SQL } from "drizzle-orm"

import { aiConfig, aiFlags } from "@/lib/ai"
import { db } from "@/lib/db"
import { folderPaths } from "@/lib/storage-report"

export type FinderFile = {
  id: string
  name: string
  size: number
  mime: string | null
  parentId: string | null
  where: string
  version: string
  thumb: string | null
  createdAt: string
  openedAt: string | null
}
export type FinderGroup = { key: string; files: FinderFile[] }

type Row = Omit<FinderFile, "where"> & { hash: string | null }

// One owner's files. `extra` adds conditions on n (node), v (current version) or o (this owner's open row).
const select = (owner: string, extra: SQL) => sql`
  select n.id, n.name, n.size::float8 as size, n.mime, n.parent_id as "parentId", v.id as version, v.thumb,
    v.sha256 as hash, n.created_at as "createdAt", o.opened_at as "openedAt"
  from nodes n
  join file_versions v on v.id = n.current_version_id
  left join node_opens o on o.node_id = n.id and o.user_id = ${owner}
  where n.owner_id = ${owner} and n.kind = 'file' and n.trashed_at is null and n.vault_id is null ${extra}`

async function place(rows: Row[]): Promise<FinderFile[]> {
  const paths = await folderPaths(rows.flatMap((r) => (r.parentId ? [r.parentId] : [])))
  return rows.map((r) => ({
    ...r,
    hash: undefined,
    createdAt: new Date(r.createdAt).toISOString(),
    openedAt: r.openedAt ? new Date(r.openedAt).toISOString() : null,
    where: r.parentId ? (paths.get(r.parentId) ?? "") : "",
  }))
}

// Oldest first, so the copy to keep is the first of its group.
const oldestFirst = (a: FinderFile, b: FinderFile) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)

// Groups of files with the same bytes: same SHA-256 and size, most space to win first.
export async function duplicates(owner: string): Promise<FinderGroup[]> {
  const rows = await db.execute<Row>(sql`
    with f as (${select(owner, sql`and v.sha256 is not null and n.size > 0`)}),
    g as (
      select hash, size from f group by hash, size having count(*) > 1
      order by (count(*) - 1) * size desc limit 100)
    select f.* from f join g using (hash, size)`)
  const by = new Map<string, Row[]>()
  for (const r of rows) by.set(`${r.hash}:${r.size}`, [...(by.get(`${r.hash}:${r.size}`) ?? []), r])
  const groups: FinderGroup[] = []
  for (const [key, rs] of by) groups.push({ key, files: (await place(rs)).sort(oldestFirst) })
  return groups.sort((a, b) => (b.files.length - 1) * b.files[0].size - (a.files.length - 1) * a.files[0].size)
}

export async function largest(owner: string, minBytes: number) {
  return place(await db.execute<Row>(sql`${select(owner, sql`and n.size >= ${minBytes}`)} order by n.size desc limit 100`))
}

// Not opened since `months` ago (never opened counts from when it was added), and added before that.
export async function notOpened(owner: string, months: number) {
  const cutoff = sql`now() - make_interval(months => ${months})`
  return place(
    await db.execute<Row>(
      sql`${select(owner, sql`and n.size > 0 and n.created_at < ${cutoff} and coalesce(o.opened_at, n.created_at) < ${cutoff}`)} order by n.size desc limit 100`
    )
  )
}

// Cosine distance under which two photos count as the same shot.
const SIMILAR = 0.08

// Photos that look alike, grouped (a similar to b, b to c puts all three together). Null when the AI picture search is off.
// ponytail: each photo's 5 nearest come from the HNSW index before the owner filter, and only the newest 3000
// photos are looked at; a big library with many members wants a bigger ef_search or an owner-partitioned scan.
export async function similar(owner: string): Promise<FinderGroup[] | null> {
  const s = await aiConfig()
  if (!s.mlClip || !(await aiFlags(owner, s)).picture) return null
  const pairs = await db.execute<{ a: string; b: string }>(sql`
    select a.node_id as a, b.node_id as b
    from (
      select e.node_id, e.vec from node_embeddings e
      join nodes n on n.id = e.node_id and n.current_version_id = e.version_id
      where e.model = ${s.clipModel} and e.t_ms is null and n.owner_id = ${owner} and n.trashed_at is null and n.vault_id is null
      order by n.created_at desc limit 3000) a
    cross join lateral (
      select e2.node_id, e2.vec <=> a.vec as d from node_embeddings e2
      join nodes n2 on n2.id = e2.node_id and n2.current_version_id = e2.version_id
      where e2.model = ${s.clipModel} and e2.t_ms is null and n2.owner_id = ${owner} and n2.trashed_at is null and n2.vault_id is null
        and e2.node_id <> a.node_id
      order by e2.vec <=> a.vec limit 5) b
    where b.d < ${SIMILAR}`)
  const parent = new Map<string, string>()
  const root = (x: string): string => {
    const p = parent.get(x) ?? x
    if (p === x) return x
    const r = root(p)
    parent.set(x, r)
    return r
  }
  for (const { a, b } of pairs) parent.set(root(a), root(b))
  const members = new Map<string, string[]>()
  for (const { a, b } of pairs) for (const x of [a, b]) members.set(root(x), [...new Set([...(members.get(root(x)) ?? []), x])])
  const ids = [...new Set([...members.values()].flat())]
  if (!ids.length) return []
  const files = new Map((await place(await db.execute<Row>(sql`${select(owner, sql`and n.id in ${ids}`)}`))).map((f) => [f.id, f]))
  return [...members.entries()]
    .map(([key, m]) => ({ key, files: m.flatMap((id) => files.get(id) ?? []).sort(oldestFirst) }))
    .filter((g) => g.files.length > 1)
    .sort((a, b) => b.files.length - a.files.length)
    .slice(0, 100)
}

// For pages: the lint rule on Date.now() in a component doesn't apply to a request-time value read here.
export const nowMs = () => Date.now()
