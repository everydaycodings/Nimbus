import "server-only"

import {
  aliasedTable,
  and,
  desc,
  eq,
  gt,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { DENSITY_COOKIE, LAYOUT_COOKIE } from "@/components/nav-styles"
import { db } from "@/lib/db"
import {
  nodes,
  settings,
  shares,
  tags,
  user,
  type TagColor,
} from "@/lib/db/schema"
import { getSession } from "@/lib/session"

// What the browser gets for each file or folder. Dates are ISO strings so they
// cross the server/client boundary.
export type Item = {
  id: string
  kind: "file" | "folder"
  name: string
  size: number
  mime: string | null
  starred: boolean
  updatedAt: string
  trashedAt: string | null
  // Ids of the viewer's own tags on it.
  tags: string[]
  owner?: string
}

export type Tag = { id: string; name: string; color: TagColor }

// File pages render alongside the layout, whose gates decide what is shown.
// They only need to know whose files to load.
export async function pageUserId() {
  const session = await getSession()
  if (!session) redirect("/sign-in")
  return session.user.id
}

export async function viewPrefs() {
  const c = await cookies()
  return {
    layout: c.get(LAYOUT_COOKIE)?.value === "list" ? "list" : "grid",
    compact: c.get(DENSITY_COOKIE)?.value === "compact",
  } as const
}

export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const cols = (viewer: string) => ({
  id: nodes.id,
  kind: nodes.kind,
  name: nodes.name,
  // A folder's size is everything inside it that shares its trash state.
  // ponytail: recursive sum per folder row; cache it on the node if big trees get slow.
  // Raw "nodes".x refs: Drizzle leaves ${column} unqualified here, which would
  // bind to the inner table.
  size: sql<number>`case when "nodes".kind = 'file' then "nodes".size else (
    with recursive d as (
      select c.id, c.size from nodes c
      where c.parent_id = "nodes".id and c.trashed_at is not distinct from "nodes".trashed_at
      union all
      select n.id, n.size from nodes n join d on n.parent_id = d.id
      where n.trashed_at is not distinct from "nodes".trashed_at
    ) select coalesce(sum(size), 0) from d) end`.mapWith(Number),
  mime: nodes.mime,
  starred: nodes.starred,
  updatedAt: nodes.updatedAt,
  trashedAt: nodes.trashedAt,
  tags: sql<string[]>`array(
    select nt.tag_id from node_tags nt join tags t on t.id = nt.tag_id
    where nt.node_id = "nodes".id and t.owner_id = ${viewer})`,
})

type Row = Omit<Item, "updatedAt" | "trashedAt"> & {
  updatedAt: Date
  trashedAt: Date | null
}

const toItem = (r: Row): Item => ({
  ...r,
  updatedAt: r.updatedAt.toISOString(),
  trashedAt: r.trashedAt?.toISOString() ?? null,
})

// Untrashed, outside any vault, owned by `ownerId`.
const live = (ownerId: string) =>
  and(
    eq(nodes.ownerId, ownerId),
    isNull(nodes.trashedAt),
    isNull(nodes.vaultId)
  )

const foldersFirst = [
  sql`${nodes.kind} = 'folder' desc`,
  sql`lower(${nodes.name})`,
]

export async function listFolder(ownerId: string, parentId: string | null) {
  const rows = await db
    .select(cols(ownerId))
    .from(nodes)
    .where(
      and(
        live(ownerId),
        parentId ? eq(nodes.parentId, parentId) : isNull(nodes.parentId)
      )
    )
    .orderBy(...foldersFirst)
  return rows.map(toItem)
}

export async function getFolder(ownerId: string, id: string) {
  if (!UUID.test(id)) return null
  const [row] = await db
    .select({ id: nodes.id, name: nodes.name })
    .from(nodes)
    .where(and(live(ownerId), eq(nodes.id, id), eq(nodes.kind, "folder")))
  return row ?? null
}

// The folder and everything above it, root first.
export async function getPath(id: string) {
  const rows = await db.execute<{ id: string; name: string }>(sql`
    with recursive up as (
      select id, name, parent_id, 0 as depth from nodes where id = ${id}
      union all
      select n.id, n.name, n.parent_id, up.depth + 1
      from nodes n join up on n.id = up.parent_id
    )
    select id, name from up order by depth desc`)
  return [...rows]
}

// ponytail: modification time stands in for "recently opened"; add an opened_at
// column when previews (Phase 6) give files something to open.
export async function listRecent(ownerId: string) {
  const rows = await db
    .select(cols(ownerId))
    .from(nodes)
    .where(live(ownerId))
    .orderBy(desc(nodes.updatedAt))
    .limit(50)
  return rows.map(toItem)
}

export async function listStarred(ownerId: string) {
  const rows = await db
    .select(cols(ownerId))
    .from(nodes)
    .where(and(live(ownerId), eq(nodes.starred, true)))
    .orderBy(...foldersFirst)
  return rows.map(toItem)
}

// Only what was trashed directly: a folder's contents went with it and come back with it.
export async function listTrash(ownerId: string) {
  const parent = aliasedTable(nodes, "parent")
  const rows = await db
    .select(cols(ownerId))
    .from(nodes)
    .leftJoin(parent, eq(parent.id, nodes.parentId))
    .where(
      and(
        eq(nodes.ownerId, ownerId),
        isNotNull(nodes.trashedAt),
        isNull(nodes.vaultId),
        sql`${parent.trashedAt} is distinct from ${nodes.trashedAt}`
      )
    )
    .orderBy(desc(nodes.trashedAt))
  return rows.map(toItem)
}

export async function listShared(userId: string) {
  const rows = await db
    .select({ ...cols(userId), owner: user.name })
    .from(shares)
    .innerJoin(nodes, eq(nodes.id, shares.nodeId))
    .innerJoin(user, eq(user.id, nodes.ownerId))
    .where(
      and(
        eq(shares.granteeId, userId),
        isNull(nodes.trashedAt),
        or(isNull(shares.expiresAt), gt(shares.expiresAt, sql`now()`))
      )
    )
    .orderBy(desc(shares.createdAt))
  return rows.map(toItem)
}

export async function getTrashRetention() {
  const [row] = await db
    .select({ days: settings.trashRetentionDays })
    .from(settings)
  return row?.days ?? null
}

// Deletes trash older than the admin's retention for everyone. Runs when a file
// page loads, so there's no scheduler to deploy.
// ponytail: rows only; Phase 5 must delete the S3 objects too (queue the keys first).
export async function purgeExpiredTrash() {
  const days = await getTrashRetention()
  if (!days) return
  await db
    .delete(nodes)
    .where(
      sql`${nodes.trashedAt} < now() - make_interval(days => ${days}::int)`
    )
}

export async function listTags(ownerId: string): Promise<Tag[]> {
  return db
    .select({ id: tags.id, name: tags.name, color: tags.color })
    .from(tags)
    .where(eq(tags.ownerId, ownerId))
    .orderBy(sql`lower(${tags.name})`)
}
