// Who can do what to a node. Owners can do everything. Anyone a node or one of
// its folders is shared with gets the highest role among those shares. What an
// editor creates belongs to the folder's owner, so a whole subtree always has
// one owner and owner-scoped queries work once the owner is known.
import "server-only"

import { sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { UUID } from "@/lib/file-rules"

export type Access = "owner" | "editor" | "viewer"

const RANK: Record<Access, number> = { viewer: 1, editor: 2, owner: 3 }

export const atLeast = (a: Access | null | undefined, min: Access) =>
  Boolean(a && RANK[a] >= RANK[min])

export type NodeAccess = {
  role: Access
  ownerId: string
  kind: "file" | "folder"
  trashed: boolean
}

// One recursive walk up from every id. Vault items are never shared.
export async function accessTo(userId: string, rawIds: string[]) {
  const ids = [...new Set(rawIds)].filter((id) => UUID.test(id))
  const out = new Map<string, NodeAccess>()
  if (!ids.length) return out
  const rows = await db.execute<{
    node: string
    owner_id: string
    kind: "file" | "folder"
    trashed: boolean
    rank: number | null
  }>(sql`
    with recursive up as (
      select id as node, id, parent_id from nodes
      where id in ${ids} and vault_id is null
      union all
      select up.node, n.id, n.parent_id from nodes n join up on n.id = up.parent_id
    )
    select n.id as node, n.owner_id, n.kind, n.trashed_at is not null as trashed,
      (select max(case s.role when 'editor' then 2 else 1 end)
       from up join shares s on s.node_id = up.id and s.grantee_id = ${userId}
       where up.node = n.id) as rank
    from nodes n where n.id in (select node from up)`)
  for (const r of rows) {
    const role: Access | null =
      r.owner_id === userId
        ? "owner"
        : r.rank === 2
          ? "editor"
          : r.rank === 1
            ? "viewer"
            : null
    if (role)
      out.set(r.node, {
        role,
        ownerId: r.owner_id,
        kind: r.kind,
        trashed: r.trashed,
      })
  }
  return out
}

export async function accessOne(userId: string, id: string) {
  return (await accessTo(userId, [id])).get(id) ?? null
}

// The one owner of `ids` if the user has at least `min` on every one of them
// (untrashed unless `trashed` is allowed), else null.
export async function ownerIfAll(
  userId: string,
  ids: string[],
  min: Access,
  { trashed = false } = {}
) {
  if (!ids.length) return null
  const got = await accessTo(userId, ids)
  let owner: string | null = null
  for (const id of ids) {
    const a = got.get(id)
    if (!a || !atLeast(a.role, min) || (a.trashed && !trashed)) return null
    if (owner && owner !== a.ownerId) return null
    owner = a.ownerId
  }
  return owner
}

// The owner of a folder the user can add to, or null. A null folder is the
// user's own root.
export async function folderOwner(userId: string, folderId: string | null) {
  if (folderId === null) return userId
  if (typeof folderId !== "string") return null
  const a = await accessOne(userId, folderId)
  return a && a.kind === "folder" && !a.trashed && atLeast(a.role, "editor")
    ? a.ownerId
    : null
}

// Editors may share further unless the owner turned that off on the item or
// any folder above it.
export async function mayShare(userId: string, id: string) {
  const a = await accessOne(userId, id)
  if (!a || a.trashed) return null
  if (a.role === "owner") return a
  if (a.role !== "editor") return null
  const [row] = await db.execute<{ blocked: boolean }>(sql`
    with recursive up as (
      select id, parent_id, allow_reshare from nodes where id = ${id}
      union all
      select n.id, n.parent_id, n.allow_reshare from nodes n join up on n.id = up.parent_id
    )
    select bool_or(not allow_reshare) as blocked from up`)
  return row?.blocked ? null : a
}

// The path a non-owner sees: from the highest folder shared with them down to
// `id`. Owners get the whole path (My files root excluded).
export async function visiblePath(userId: string, id: string) {
  const rows = await db.execute<{
    id: string
    name: string
    owner_id: string
    shared: boolean
  }>(sql`
    with recursive up as (
      select id, name, parent_id, owner_id, 0 as depth from nodes where id = ${id}
      union all
      select n.id, n.name, n.parent_id, n.owner_id, up.depth + 1
      from nodes n join up on n.id = up.parent_id
    )
    select id, name, owner_id, exists (
      select 1 from shares s where s.node_id = up.id and s.grantee_id = ${userId}
    ) as shared
    from up order by depth desc`)
  if (!rows.length || rows[0].owner_id === userId)
    return rows.map(({ id, name }) => ({ id, name }))
  const top = rows.findIndex((r) => r.shared)
  return top < 0 ? [] : rows.slice(top).map(({ id, name }) => ({ id, name }))
}

// The ids the user can see (untrashed), for downloads. Member viewers can
// always download.
export async function viewable(userId: string, ids: string[]) {
  const access = await accessTo(userId, ids)
  return ids.filter((id) => {
    const a = access.get(id)
    return a && !a.trashed
  })
}
