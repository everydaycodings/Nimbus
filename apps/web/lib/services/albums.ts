// Albums: named sets of photos that stay where they are. The owner and the people an album is
// shared with (viewer, or contributor who may add their own photos) or a public link see them;
// lib/access gives members read access to the photos themselves. GPS is never part of any of this.
import "server-only"

import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm"
import type {
  Album,
  AlbumPatch,
  AlbumPerson,
  AlbumPhoto,
  AlbumResponse,
  AlbumRole,
  AlbumSharePatch,
  AlbumSharesResponse,
} from "@nimbus/shared/api"

import { db } from "@/lib/db"
import { albumItems, albumShares, albums, nodes, user } from "@/lib/db/schema"
import { UUID, ownMedia, photoItems } from "@/lib/files"
import { hashLinkPassword, newLinkToken } from "@/lib/links"
import { notify } from "@/lib/notify"
import type { Me } from "@/lib/session"
import { getSettings } from "@/lib/signup"
import { linkExpiry } from "@/lib/services/shares"

type Result = { error?: string }
const GONE = "That album isn't available anymore."
const DAY = 24 * 60 * 60 * 1000

// The album and what I am to it, or null.
async function open(me: Me, id: string) {
  if (!UUID.test(String(id))) return null
  const [a] = await db.select().from(albums).where(eq(albums.id, id))
  if (!a) return null
  if (a.ownerId === me.id) return { album: a, role: "owner" as AlbumRole }
  const [s] = await db
    .select({ role: albumShares.role })
    .from(albumShares)
    .where(and(eq(albumShares.albumId, id), eq(albumShares.granteeId, me.id)))
  return s ? { album: a, role: s.role as AlbumRole } : null
}

const cleanName = (raw: unknown) => String(raw ?? "").trim().slice(0, 80)

// Everyone who should hear about changes: the owner and the people it's shared with.
async function members(albumId: string) {
  const rows = await db.execute<{ id: string }>(sql`
    select owner_id as id from albums where id = ${albumId}
    union select grantee_id from album_shares where album_id = ${albumId} and grantee_id is not null`)
  return rows.map((r) => r.id)
}

// ---- Albums ----

export async function listAlbums(me: Me): Promise<Album[]> {
  const rows = await db.execute<{
    id: string
    name: string
    owner_id: string
    owner_name: string
    role: AlbumRole
    count: number
    cover_id: string | null
    cover_version: string | null
    cover_thumb: string | null
    shared: boolean
    created_at: Date
    updated_at: Date
  }>(sql`
    select a.id, a.name, a.owner_id, coalesce(nullif(u.name, ''), u.email) as owner_name,
      case when a.owner_id = ${me.id} then 'owner' else s.role end as role,
      (select count(*)::int from album_items ai join nodes n on n.id = ai.node_id
        where ai.album_id = a.id and n.trashed_at is null) as count,
      c.id as cover_id, c.current_version_id as cover_version,
      (select thumb from file_versions where id = c.current_version_id) as cover_thumb,
      exists (select 1 from album_shares x where x.album_id = a.id) as shared,
      a.created_at, a.updated_at
    from albums a
    join "user" u on u.id = a.owner_id
    left join album_shares s on s.album_id = a.id and s.grantee_id = ${me.id}
    left join lateral (
      select n.id, n.current_version_id from nodes n
      where n.trashed_at is null and n.id = coalesce(
        (select cover_node_id from albums where id = a.id),
        (select ai2.node_id from album_items ai2 join nodes n2 on n2.id = ai2.node_id
          where ai2.album_id = a.id and n2.trashed_at is null
          order by ai2.added_at desc limit 1))
      limit 1
    ) c on true
    where a.owner_id = ${me.id} or s.id is not null
    order by a.updated_at desc`)
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    ownerId: r.owner_id,
    ownerName: r.owner_name,
    role: r.role,
    count: r.count,
    cover: r.cover_id
      ? { id: r.cover_id, version: r.cover_version, thumb: r.cover_thumb }
      : null,
    shared: r.shared,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  }))
}

export async function createAlbum(
  me: Me,
  input: { name: string; nodeIds?: string[] }
): Promise<Result & { id?: string }> {
  const name = cleanName(input.name)
  if (!name) return { error: "Give the album a name." }
  const [row] = await db
    .insert(albums)
    .values({ ownerId: me.id, name })
    .returning({ id: albums.id })
  if (input.nodeIds?.length) await addItems(me, row.id, input.nodeIds)
  return { id: row.id }
}

export async function getAlbum(me: Me, id: string): Promise<AlbumResponse | null> {
  const a = await open(me, id)
  if (!a) return null
  const [album] = (await listAlbums(me)).filter((x) => x.id === id)
  if (!album) return null
  const { items } = await photoItems(
    me.id,
    and(
      eq(nodes.kind, "file"),
      isNull(nodes.trashedAt),
      isNull(nodes.vaultId),
      sql`"nodes".id in (select node_id from album_items where album_id = ${id})`
    ),
    2000
  )
  const added = new Map(
    (
      await db
        .select({ nodeId: albumItems.nodeId, by: albumItems.addedBy })
        .from(albumItems)
        .where(eq(albumItems.albumId, id))
    ).map((r) => [r.nodeId, r.by])
  )
  return {
    album,
    items: items.map((i): AlbumPhoto => {
      const by = added.get(i.id) ?? null
      return {
        ...i,
        addedBy: by,
        canRemove: a.role === "owner" || (a.role === "contributor" && by === me.id),
      }
    }),
  }
}

export async function updateAlbum(me: Me, id: string, patch: AlbumPatch): Promise<Result> {
  const a = await open(me, id)
  if (a?.role !== "owner") return { error: a ? "Only the owner can change an album." : GONE }
  const set: Partial<typeof albums.$inferInsert> = { updatedAt: new Date() }
  if (patch.name !== undefined) {
    const name = cleanName(patch.name)
    if (!name) return { error: "Give the album a name." }
    set.name = name
  }
  if (patch.coverNodeId !== undefined) {
    if (patch.coverNodeId === null) set.coverNodeId = null
    else {
      const [it] = UUID.test(patch.coverNodeId)
        ? await db
            .select({ n: albumItems.nodeId })
            .from(albumItems)
            .where(and(eq(albumItems.albumId, id), eq(albumItems.nodeId, patch.coverNodeId)))
        : []
      if (!it) return { error: "That photo isn't in the album." }
      set.coverNodeId = patch.coverNodeId
    }
  }
  await db.update(albums).set(set).where(eq(albums.id, id))
  return {}
}

export async function deleteAlbum(me: Me, id: string): Promise<Result> {
  const a = await open(me, id)
  if (a?.role !== "owner") return { error: a ? "Only the owner can delete an album." : GONE }
  await db.delete(albums).where(eq(albums.id, id))
  return {}
}

// ---- Items ----

// Owner and contributors add their own photos and videos (never someone else's, so an album
// can't hand out a photo its owner never shared).
export async function addItems(
  me: Me,
  id: string,
  nodeIds: string[]
): Promise<Result & { added?: number }> {
  const a = await open(me, id)
  if (!a || a.role === "viewer") return { error: a ? "You can't change this album." : GONE }
  const ids = (Array.isArray(nodeIds) ? nodeIds : []).filter((x) => UUID.test(x)).slice(0, 1000)
  const mine = ids.length
    ? await db.select({ id: nodes.id }).from(nodes).where(and(ownMedia(me.id), inArray(nodes.id, ids)))
    : []
  if (!mine.length) return { error: "Only your own photos and videos can be added." }
  const done = await db
    .insert(albumItems)
    .values(mine.map((n) => ({ albumId: id, nodeId: n.id, addedBy: me.id })))
    .onConflictDoNothing()
    .returning({ nodeId: albumItems.nodeId })
  if (done.length) {
    await db.update(albums).set({ updatedAt: new Date() }).where(eq(albums.id, id))
    for (const m of await members(id))
      await notify(m, "album", {
        actorId: me.id,
        data: { what: "added", album: id, name: a.album.name },
      })
  }
  return { added: done.length }
}

// The owner takes out anything; a contributor only what they added.
export async function removeItems(me: Me, id: string, nodeIds: string[]): Promise<Result> {
  const a = await open(me, id)
  if (!a || a.role === "viewer") return { error: a ? "You can't change this album." : GONE }
  const ids = (Array.isArray(nodeIds) ? nodeIds : []).filter((x) => UUID.test(x))
  if (!ids.length) return {}
  await db
    .delete(albumItems)
    .where(
      and(
        eq(albumItems.albumId, id),
        inArray(albumItems.nodeId, ids),
        a.role === "owner" ? undefined : eq(albumItems.addedBy, me.id)
      )
    )
  await db.update(albums).set({ updatedAt: new Date() }).where(eq(albums.id, id))
  return {}
}

// ---- Shares ----

export async function listShares(me: Me, id: string): Promise<AlbumSharesResponse | null> {
  const a = await open(me, id)
  if (a?.role !== "owner") return null
  const people = await db
    .select({
      shareId: albumShares.id,
      userId: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      role: albumShares.role,
    })
    .from(albumShares)
    .innerJoin(user, eq(user.id, albumShares.granteeId))
    .where(eq(albumShares.albumId, id))
    .orderBy(user.name)
  const links = await db
    .select()
    .from(albumShares)
    .where(and(eq(albumShares.albumId, id), sql`${albumShares.token} is not null`))
    .orderBy(albumShares.createdAt)
  return {
    people: people.map((p): AlbumPerson => ({ ...p, name: p.name || p.email })),
    links: links.map((l) => ({
      shareId: l.id,
      token: l.token!,
      name: l.name,
      expiresAt: l.expiresAt?.toISOString() ?? null,
      hasPassword: Boolean(l.passwordHash),
      allowDownload: l.allowDownload,
      views: l.viewCount,
    })),
  }
}

export async function shareWith(
  me: Me,
  id: string,
  userId: string,
  role: "viewer" | "contributor"
): Promise<Result & { id?: string }> {
  const a = await open(me, id)
  if (a?.role !== "owner") return { error: a ? "Only the owner can share an album." : GONE }
  if (role !== "viewer" && role !== "contributor") return { error: "Pick viewer or contributor." }
  const [target] = await db
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.id, String(userId)), eq(user.status, "active"), ne(user.id, me.id)))
  if (!target) return { error: "That person isn't available anymore." }
  const [row] = await db
    .insert(albumShares)
    .values({ albumId: id, granteeId: target.id, role, createdBy: me.id })
    .onConflictDoUpdate({
      target: [albumShares.albumId, albumShares.granteeId],
      targetWhere: sql`${albumShares.granteeId} is not null`,
      set: { role },
    })
    .returning({ id: albumShares.id, created: sql<boolean>`xmax = 0` })
  if (row.created)
    await notify(target.id, "album", {
      actorId: me.id,
      data: { what: "shared", album: id, name: a.album.name, role },
    })
  return { id: row.id }
}

async function ownShare(me: Me, id: string, shareId: string) {
  const a = await open(me, id)
  if (a?.role !== "owner" || !UUID.test(String(shareId))) return null
  const [s] = await db
    .select()
    .from(albumShares)
    .where(and(eq(albumShares.id, shareId), eq(albumShares.albumId, id)))
  return s ?? null
}

export async function updateShare(
  me: Me,
  id: string,
  shareId: string,
  patch: AlbumSharePatch
): Promise<Result> {
  const s = await ownShare(me, id, shareId)
  if (!s) return { error: GONE }
  const set: Partial<typeof albumShares.$inferInsert> = {}
  if (patch.role !== undefined) {
    if (patch.role !== "viewer" && patch.role !== "contributor")
      return { error: "Pick viewer or contributor." }
    if (s.token) return { error: "Links can only view." }
    set.role = patch.role
  }
  if (s.token) {
    if (patch.name !== undefined) {
      const name = String(patch.name).trim().slice(0, 80)
      if (!name) return { error: "Give the link a name." }
      set.name = name
    }
    const exp = await linkExpiry(patch.expiresAt)
    if (exp.error) return { error: exp.error }
    if (exp.value !== undefined) set.expiresAt = exp.value
    if (patch.password !== undefined) {
      const pw = String(patch.password)
      if (!pw && (await getSettings()).requireLinkPassword)
        return { error: "Links on this Nimbus need a password." }
      if (pw && pw.length < 4) return { error: "Use at least 4 characters." }
      set.passwordHash = pw ? await hashLinkPassword(pw) : null
      set.pwRev = s.pwRev + 1
    }
    if (patch.allowDownload !== undefined) set.allowDownload = Boolean(patch.allowDownload)
  }
  if (Object.keys(set).length) await db.update(albumShares).set(set).where(eq(albumShares.id, s.id))
  return {}
}

export async function removeShare(me: Me, id: string, shareId: string): Promise<Result> {
  const s = await ownShare(me, id, shareId)
  if (!s) return { error: GONE }
  await db.delete(albumShares).where(eq(albumShares.id, s.id))
  return {}
}

export async function createLink(
  me: Me,
  id: string,
  opts: { name?: string; password?: string } = {}
): Promise<Result & { id?: string; token?: string }> {
  const a = await open(me, id)
  if (a?.role !== "owner") return { error: a ? "Only the owner can share an album." : GONE }
  const settings = await getSettings()
  if (!settings.publicLinksEnabled) return { error: "Your admin turned public links off." }
  const password = String(opts.password ?? "")
  if (settings.requireLinkPassword && !password)
    return { error: "Links on this Nimbus need a password." }
  if (password && password.length < 4) return { error: "Use at least 4 characters." }
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(albumShares)
    .where(and(eq(albumShares.albumId, id), sql`${albumShares.token} is not null`))
  const [row] = await db
    .insert(albumShares)
    .values({
      albumId: id,
      token: newLinkToken(),
      createdBy: me.id,
      name: String(opts.name ?? "").trim().slice(0, 80) || `Link ${n + 1}`,
      passwordHash: password ? await hashLinkPassword(password) : null,
      expiresAt: settings.maxLinkDays ? new Date(Date.now() + settings.maxLinkDays * DAY) : null,
    })
    .returning({ id: albumShares.id, token: albumShares.token })
  return { id: row.id, token: row.token! }
}
