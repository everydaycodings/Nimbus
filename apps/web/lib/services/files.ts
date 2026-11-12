import "server-only"

import {
  and,
  count,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm"

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
import { recordOne } from "@/lib/activity"
import { getFolder, getPath, markOpened, UUID } from "@/lib/files"
import { checkStorage } from "@/lib/quota"
import type { Me } from "@/lib/session"
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

export type Result = { error?: string }

export async function createFolder(
  me: Me,
  parentId: string | null,
  raw: string
): Promise<Result & { id?: string }> {
  return createFolderAs(me.id, parentId, raw)
}

export async function renameItem(me: Me, id: string, raw: string): Promise<Result> {
  const r = await renameAs(me.id, id, raw)
  if (r.error) return r
  await markOpened(me.id, id)
  return {}
}

export async function moveItems(
  me: Me,
  rawIds: string[],
  parentId: string | null
): Promise<Result> {
  const r = await moveAs(me.id, rawIds, parentId)
  if (r.error) return r
  return {}
}

export async function setStarred(me: Me, rawIds: string[], starred: boolean) {
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
}

export async function trashItems(me: Me, rawIds: string[]): Promise<Result> {
  const r = await trashAs(me.id, rawIds)
  if (r.error) return r
  return {}
}

// One transaction per item, so a name clash on one doesn't hold back the rest.
export async function restoreItems(me: Me, rawIds: string[]): Promise<Result> {
  const ids = cleanIds(rawIds)
  // Editors can undo their own trashing.
  const owner = await ownerIfAll(me.id, ids, "editor", { trashed: true })
  if (!owner) return { error: NOT_ALLOWED }
  const failed: string[] = []
  for (const id of ids) {
    try {
      if (await db.transaction((tx) => restoreNode(tx, owner, id)))
        await recordOne(id, me.id, "restore")
    } catch (e) {
      if (!isClash(e)) throw e
      const [row] = await db
        .select({ name: nodes.name })
        .from(nodes)
        .where(eq(nodes.id, id))
      failed.push(row?.name ?? "An item")
    }
  }
  if (failed.length)
    return {
      error: `${failed.map((n) => `“${n}”`).join(", ")} couldn't come back because something with the same name is in its folder now. Rename that one, then restore again.`,
    }
  return {}
}

export async function deleteForever(me: Me, rawIds: string[]) {
  const ids = cleanIds(rawIds)
  if (ids.length)
    await deleteNodes(and(owned(me.id, ids), isNotNull(nodes.trashedAt)))
  await checkStorage(me.id)
}

export async function emptyTrash(me: Me) {
  await deleteNodes(and(eq(nodes.ownerId, me.id), isNotNull(nodes.trashedAt)))
  await checkStorage(me.id)
}

// For the move dialog's folder picker. Inside someone else's folder, its
// owner's subfolders.
export async function listFolders(me: Me, parentId: string | null) {
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
export async function getDetails(me: Me, id: string) {
  if (!UUID.test(id)) return null
  const [row] = await db
    .select({
      ownerId: nodes.ownerId,
      owner: user.name,
      parentId: nodes.parentId,
      kind: nodes.kind,
      version: nodes.currentVersionId,
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
    // The folder it's in, for saving a new version from elsewhere; null at the top or when that folder isn't mine to see.
    parentId:
      row.parentId && (mine || (await accessOne(me.id, row.parentId))) ? row.parentId : null,
    role: access.role,
    // The current version's id: an editor compares it to see if the file changed under it.
    version: row.version,
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
  me: Me,
  raw: string,
  color: TagColor,
  applyTo: string[]
): Promise<Result> {
  const name = raw.trim()
  if (!name) return { error: "Enter a name." }
  if (name.length > 40) return { error: "Keep tag names under 40 characters." }
  if (!TAG_COLORS.includes(color)) return { error: "Pick a color." }
  try {
    const [tag] = await db
      .insert(tags)
      .values({ ownerId: me.id, name, color })
      .returning({ id: tags.id })
    await tagItems(me, applyTo, tag.id, true)
  } catch (e) {
    if (isClash(e)) return { error: "You already have a tag with that name." }
    throw e
  }
  return {}
}

export async function tagItems(me: Me, rawIds: string[], tagId: string, on: boolean) {
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
}

async function myTag(userId: string, id: string) {
  if (!UUID.test(id)) return null
  const [tag] = await db
    .select()
    .from(tags)
    .where(and(eq(tags.id, id), eq(tags.ownerId, userId)))
  return tag ?? null
}

// A name already used by another of your tags returns { merge } instead, so the
// UI can ask before calling mergeTags.
export async function renameTag(
  me: Me,
  id: string,
  raw: string
): Promise<Result & { merge?: string }> {
  const name = raw.trim()
  if (!name) return { error: "Enter a name." }
  if (name.length > 40) return { error: "Keep tag names under 40 characters." }
  const tag = await myTag(me.id, id)
  if (!tag) return { error: NOT_ALLOWED }
  const [other] = await db
    .select({ id: tags.id })
    .from(tags)
    .where(
      and(
        eq(tags.ownerId, me.id),
        sql`lower(${tags.name}) = lower(${name})`,
        sql`${tags.id} <> ${id}`
      )
    )
  if (other) return { merge: other.id }
  await db.update(tags).set({ name }).where(eq(tags.id, id))
  return {}
}

// Moves every item tagged `from` onto `into`, then drops `from`.
export async function mergeTags(me: Me, from: string, into: string): Promise<Result> {
  if (from === into) return {}
  const [a, b] = [await myTag(me.id, from), await myTag(me.id, into)]
  if (!a || !b) return { error: NOT_ALLOWED }
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      insert into node_tags (node_id, tag_id)
      select node_id, ${into} from node_tags where tag_id = ${from}
      on conflict do nothing`)
    await tx.delete(tags).where(eq(tags.id, from))
  })
  return {}
}

export async function recolorTag(me: Me, id: string, color: TagColor): Promise<Result> {
  if (!TAG_COLORS.includes(color)) return { error: "Pick a color." }
  if (!(await myTag(me.id, id))) return { error: NOT_ALLOWED }
  await db.update(tags).set({ color }).where(eq(tags.id, id))
  return {}
}

// How many items carry the tag, for "Remove 'X' from N items?".
export async function tagCount(me: Me, id: string): Promise<number> {
  if (!(await myTag(me.id, id))) return 0
  const [r] = await db
    .select({ n: count() })
    .from(nodeTags)
    .where(eq(nodeTags.tagId, id))
  return r.n
}

export type TagSnapshot = {
  tag: { id: string; name: string; color: TagColor }
  nodeIds: string[]
}

// Returns what restoreTag needs to undo it.
export async function deleteTag(me: Me, id: string): Promise<TagSnapshot | null> {
  const tag = await myTag(me.id, id)
  if (!tag) return null
  const rows = await db
    .select({ nodeId: nodeTags.nodeId })
    .from(nodeTags)
    .where(eq(nodeTags.tagId, id))
  await db.delete(tags).where(eq(tags.id, id))
  return {
    tag: { id: tag.id, name: tag.name, color: tag.color },
    nodeIds: rows.map((r) => r.nodeId),
  }
}

export async function restoreTag(me: Me, snap: TagSnapshot): Promise<Result> {
  const { id, name, color } = snap.tag
  if (!UUID.test(id) || !TAG_COLORS.includes(color))
    return { error: NOT_ALLOWED }
  try {
    await db.insert(tags).values({ id, ownerId: me.id, name, color })
  } catch (e) {
    if (isClash(e)) return { error: "You already have a tag with that name." }
    throw e
  }
  // Only items you can still reach get it back.
  const ids = snap.nodeIds.filter((n) => UUID.test(n))
  const allowed = [...(await accessTo(me.id, ids)).keys()]
  if (allowed.length)
    await db
      .insert(nodeTags)
      .values(allowed.map((nodeId) => ({ nodeId, tagId: id })))
      .onConflictDoNothing()
  return {}
}

// "Add shortcut to My files" for something shared with you.
export async function addShortcut(me: Me, nodeId: string): Promise<Result> {
  const a = UUID.test(nodeId) ? await accessOne(me.id, nodeId) : null
  if (!a || a.role === "owner" || a.trashed) return { error: NOT_ALLOWED }
  await db
    .insert(shortcuts)
    .values({ userId: me.id, nodeId })
    .onConflictDoNothing()
  return {}
}

export async function removeShortcut(me: Me, nodeId: string): Promise<Result> {
  if (!UUID.test(nodeId)) return {}
  await db
    .delete(shortcuts)
    .where(and(eq(shortcuts.userId, me.id), eq(shortcuts.nodeId, nodeId)))
  return {}
}
