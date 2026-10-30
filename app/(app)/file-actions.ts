"use server"

import {
  and,
  count,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm"
import { refresh } from "next/cache"

import { db } from "@/lib/db"
import {
  TAG_COLORS,
  nodeTags,
  nodes,
  shares,
  shortcuts,
  stars,
  tags,
  user,
  type TagColor,
} from "@/lib/db/schema"
import {
  accessOne,
  accessTo,
  ownerIfAll,
  visiblePath,
} from "@/lib/access"
import { getFolder, getPath, markOpened, UUID } from "@/lib/files"
import { requireMember } from "@/lib/session"
import { restoreNode } from "@/lib/tree"
import {
  NOT_ALLOWED,
  cleanIds,
  createFolderAs,
  moveAs,
  owned,
  renameAs,
  trashAs,
} from "@/lib/tree-ops"
import { deleteNodes, isClash } from "@/lib/uploads"

type Result = { error?: string }

export async function createFolder(
  parentId: string | null,
  raw: string
): Promise<Result> {
  const me = await requireMember()
  const r = await createFolderAs(me.id, parentId, raw)
  if (r.error) return { error: r.error }
  refresh()
  return {}
}

export async function renameItem(id: string, raw: string): Promise<Result> {
  const me = await requireMember()
  const r = await renameAs(me.id, id, raw)
  if (r.error) return r
  await markOpened(me.id, id)
  refresh()
  return {}
}

export async function moveItems(
  rawIds: string[],
  parentId: string | null
): Promise<Result> {
  const me = await requireMember()
  const r = await moveAs(me.id, rawIds, parentId)
  if (r.error) return r
  refresh()
  return {}
}

export async function setStarred(rawIds: string[], starred: boolean) {
  const me = await requireMember()
  const ids = cleanIds(rawIds)
  if (starred) {
    const seen = [...(await accessTo(me.id, ids)).keys()]
    if (seen.length)
      await db
        .insert(stars)
        .values(seen.map((nodeId) => ({ userId: me.id, nodeId })))
        .onConflictDoNothing()
  } else if (ids.length)
    await db
      .delete(stars)
      .where(and(eq(stars.userId, me.id), inArray(stars.nodeId, ids)))
  refresh()
}

export async function trashItems(rawIds: string[]): Promise<Result> {
  const me = await requireMember()
  const r = await trashAs(me.id, rawIds)
  if (r.error) return r
  refresh()
  return {}
}

// One transaction per item, so a name clash on one doesn't hold back the rest.
export async function restoreItems(rawIds: string[]): Promise<Result> {
  const me = await requireMember()
  const ids = cleanIds(rawIds)
  // Editors can undo their own trashing.
  const owner = await ownerIfAll(me.id, ids, "editor", { trashed: true })
  if (!owner) return { error: NOT_ALLOWED }
  const failed: string[] = []
  for (const id of ids) {
    try {
      await db.transaction((tx) => restoreNode(tx, owner, id))
    } catch (e) {
      if (!isClash(e)) throw e
      const [row] = await db
        .select({ name: nodes.name })
        .from(nodes)
        .where(eq(nodes.id, id))
      failed.push(row?.name ?? "An item")
    }
  }
  refresh()
  if (failed.length)
    return {
      error: `${failed.map((n) => `“${n}”`).join(", ")} couldn't come back because something with the same name is in its folder now. Rename that one, then restore again.`,
    }
  return {}
}

export async function deleteForever(rawIds: string[]) {
  const me = await requireMember()
  const ids = cleanIds(rawIds)
  if (ids.length)
    await deleteNodes(and(owned(me.id, ids), isNotNull(nodes.trashedAt)))
  refresh()
}

export async function emptyTrash() {
  const me = await requireMember()
  await deleteNodes(and(eq(nodes.ownerId, me.id), isNotNull(nodes.trashedAt)))
  refresh()
}

// For the move dialog's folder picker. Inside someone else's folder, its
// owner's subfolders.
export async function listFolders(parentId: string | null) {
  const me = await requireMember()
  if (parentId && !UUID.test(parentId)) return []
  const owner = parentId ? (await getFolder(me.id, parentId))?.ownerId : me.id
  if (!owner) return []
  return db
    .select({ id: nodes.id, name: nodes.name })
    .from(nodes)
    .where(
      and(
        eq(nodes.ownerId, owner),
        eq(nodes.kind, "folder"),
        isNull(nodes.trashedAt),
        isNull(nodes.vaultId),
        parentId ? eq(nodes.parentId, parentId) : isNull(nodes.parentId)
      )
    )
    .orderBy(sql`lower(${nodes.name})`)
}

// For the details panel. Owners see everything; people it's shared with see the
// item itself but not where it lives.
export async function getDetails(id: string) {
  const me = await requireMember()
  if (!UUID.test(id)) return null
  const [row] = await db
    .select({
      ownerId: nodes.ownerId,
      owner: user.name,
      parentId: nodes.parentId,
      kind: nodes.kind,
      createdAt: nodes.createdAt,
      trashedAt: nodes.trashedAt,
    })
    .from(nodes)
    .innerJoin(user, eq(user.id, nodes.ownerId))
    .where(eq(nodes.id, id))
  const access = await accessOne(me.id, id)
  if (!row || !access) return null
  const mine = access.role === "owner"

  // Everything inside a folder that shares its trash state.
  const contents =
    row.kind === "folder"
      ? (
          await db.execute<{
            folders: number
            files: number
            bytes: string
          }>(sql`
            with recursive d as (
              select id from nodes where parent_id = ${id}
                and trashed_at is not distinct from ${row.trashedAt?.toISOString() ?? null}::timestamptz
              union all
              select n.id from nodes n join d on n.parent_id = d.id
                and n.trashed_at is not distinct from ${row.trashedAt?.toISOString() ?? null}::timestamptz
            )
            select count(*) filter (where kind = 'folder')::int as folders,
                   count(*) filter (where kind = 'file')::int as files,
                   coalesce(sum(size), 0)::text as bytes
            from nodes where id in (select id from d)`)
        )[0]
      : null

  const [{ n: shareCount }] = await db
    .select({ n: count() })
    .from(shares)
    .where(eq(shares.nodeId, id))

  return {
    owner: mine ? "You" : row.owner,
    createdAt: row.createdAt.toISOString(),
    location: mine
      ? [
          "My files",
          ...(row.parentId
            ? (await getPath(row.parentId)).map((p) => p.name)
            : []),
        ]
      : row.parentId
        ? [
            "Shared with me",
            ...(await visiblePath(me.id, row.parentId)).map((p) => p.name),
          ]
        : null,
    role: access.role,
    contents: contents && {
      folders: contents.folders,
      files: contents.files,
      bytes: Number(contents.bytes),
    },
    shares: mine ? shareCount : null,
  }
}

export type Details = NonNullable<Awaited<ReturnType<typeof getDetails>>>


// Makes a tag and puts it on `applyTo` in one go, the way "New tag…" is used.
export async function createTag(
  raw: string,
  color: TagColor,
  applyTo: string[]
): Promise<Result> {
  const me = await requireMember()
  const name = raw.trim()
  if (!name) return { error: "Enter a name." }
  if (name.length > 40) return { error: "Keep tag names under 40 characters." }
  if (!TAG_COLORS.includes(color)) return { error: "Pick a color." }
  try {
    const [tag] = await db
      .insert(tags)
      .values({ ownerId: me.id, name, color })
      .returning({ id: tags.id })
    await tagItems(applyTo, tag.id, true)
  } catch (e) {
    if (isClash(e)) return { error: "You already have a tag with that name." }
    throw e
  }
  refresh()
  return {}
}

export async function tagItems(rawIds: string[], tagId: string, on: boolean) {
  const me = await requireMember()
  const ids = cleanIds(rawIds)
  if (!ids.length || !UUID.test(tagId)) return
  const [tag] = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.id, tagId), eq(tags.ownerId, me.id)))
  if (!tag) return
  if (on) {
    const allowed = [...(await accessTo(me.id, ids)).keys()]
    if (allowed.length)
      await db
        .insert(nodeTags)
        .values(allowed.map((nodeId) => ({ nodeId, tagId })))
        .onConflictDoNothing()
  } else {
    await db
      .delete(nodeTags)
      .where(and(eq(nodeTags.tagId, tagId), inArray(nodeTags.nodeId, ids)))
  }
  refresh()
}

// "Add shortcut to My files" for something shared with you.
export async function addShortcut(nodeId: string): Promise<Result> {
  const me = await requireMember()
  const a = UUID.test(nodeId) ? await accessOne(me.id, nodeId) : null
  if (!a || a.role === "owner" || a.trashed) return { error: NOT_ALLOWED }
  await db
    .insert(shortcuts)
    .values({ userId: me.id, nodeId })
    .onConflictDoNothing()
  refresh()
  return {}
}

export async function removeShortcut(nodeId: string): Promise<Result> {
  const me = await requireMember()
  if (!UUID.test(nodeId)) return {}
  await db
    .delete(shortcuts)
    .where(and(eq(shortcuts.userId, me.id), eq(shortcuts.nodeId, nodeId)))
  refresh()
  return {}
}
