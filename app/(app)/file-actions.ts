"use server"

import {
  and,
  count,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm"
import { refresh } from "next/cache"

import { db } from "@/lib/db"
import {
  TAG_COLORS,
  nodeTags,
  nodes,
  shares,
  tags,
  user,
  type TagColor,
} from "@/lib/db/schema"
import { getPath, UUID } from "@/lib/files"
import { requireMember } from "@/lib/session"
import { restoreNode, trashNodes } from "@/lib/tree"

type Result = { error?: string }

const CLASH = "Something with that name is already in this folder."

// Postgres unique_violation, raw or wrapped by Drizzle.
function isClash(e: unknown) {
  const err = e as { code?: string; cause?: { code?: string } }
  return (err.cause?.code ?? err.code) === "23505"
}

function cleanName(raw: string) {
  const name = raw.trim()
  if (!name) return { error: "Enter a name." }
  if (name.length > 255) return { error: "Keep names under 255 characters." }
  if (name === "." || name === ".." || /[/\\\0]/.test(name))
    return { error: "Names can't be . or .. or contain / or \\." }
  return { name }
}

function cleanIds(ids: string[]) {
  return Array.isArray(ids)
    ? ids.filter((id) => UUID.test(id)).slice(0, 1000)
    : []
}

const owned = (ownerId: string, ids: string[]) =>
  and(eq(nodes.ownerId, ownerId), inArray(nodes.id, ids))

// A folder the user can put things in: theirs, untrashed, outside any vault.
async function isOpenFolder(ownerId: string, id: string) {
  const [row] = await db
    .select({ id: nodes.id })
    .from(nodes)
    .where(
      and(
        owned(ownerId, [id]),
        eq(nodes.kind, "folder"),
        isNull(nodes.trashedAt),
        isNull(nodes.vaultId)
      )
    )
  return Boolean(row)
}

export async function createFolder(
  parentId: string | null,
  raw: string
): Promise<Result> {
  const me = await requireMember()
  const clean = cleanName(raw)
  if ("error" in clean) return clean
  if (
    parentId &&
    !(UUID.test(parentId) && (await isOpenFolder(me.id, parentId)))
  )
    return { error: "That folder is gone. Refresh and try again." }
  try {
    await db
      .insert(nodes)
      .values({ ownerId: me.id, parentId, kind: "folder", name: clean.name })
  } catch (e) {
    if (isClash(e)) return { error: CLASH }
    throw e
  }
  refresh()
  return {}
}

export async function renameItem(id: string, raw: string): Promise<Result> {
  const me = await requireMember()
  const clean = cleanName(raw)
  if ("error" in clean) return clean
  try {
    await db
      .update(nodes)
      .set({ name: clean.name, updatedAt: new Date() })
      .where(and(owned(me.id, cleanIds([id])), isNull(nodes.trashedAt)))
  } catch (e) {
    if (isClash(e)) return { error: CLASH }
    throw e
  }
  refresh()
  return {}
}

export async function moveItems(
  rawIds: string[],
  parentId: string | null
): Promise<Result> {
  const me = await requireMember()
  const ids = cleanIds(rawIds)
  if (parentId) {
    if (!UUID.test(parentId) || !(await isOpenFolder(me.id, parentId)))
      return { error: "That folder is gone. Refresh and try again." }
    // The target and its ancestors can't be among the things being moved.
    const up = await db.execute<{ id: string }>(sql`
      with recursive up as (
        select id, parent_id from nodes where id = ${parentId}
        union all
        select n.id, n.parent_id from nodes n join up on n.id = up.parent_id
      )
      select id from up`)
    if (up.some((r) => ids.includes(r.id)))
      return { error: "A folder can't go inside itself." }
  }
  try {
    await db
      .update(nodes)
      .set({ parentId, updatedAt: new Date() })
      .where(and(owned(me.id, ids), isNull(nodes.trashedAt)))
  } catch (e) {
    if (isClash(e))
      return {
        error: "Something with the same name is already in that folder.",
      }
    throw e
  }
  refresh()
  return {}
}

export async function setStarred(rawIds: string[], starred: boolean) {
  const me = await requireMember()
  await db
    .update(nodes)
    .set({ starred })
    .where(and(owned(me.id, cleanIds(rawIds)), isNull(nodes.trashedAt)))
  refresh()
}

export async function trashItems(rawIds: string[]) {
  const me = await requireMember()
  await trashNodes(db, me.id, cleanIds(rawIds))
  refresh()
}

// One transaction per item, so a name clash on one doesn't hold back the rest.
export async function restoreItems(rawIds: string[]): Promise<Result> {
  const me = await requireMember()
  const failed: string[] = []
  for (const id of cleanIds(rawIds)) {
    try {
      await db.transaction((tx) => restoreNode(tx, me.id, id))
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
  await db
    .delete(nodes)
    .where(and(owned(me.id, cleanIds(rawIds)), isNotNull(nodes.trashedAt)))
  refresh()
}

export async function emptyTrash() {
  const me = await requireMember()
  await db
    .delete(nodes)
    .where(and(eq(nodes.ownerId, me.id), isNotNull(nodes.trashedAt)))
  refresh()
}

// For the move dialog's folder picker.
export async function listFolders(parentId: string | null) {
  const me = await requireMember()
  if (parentId && !UUID.test(parentId)) return []
  return db
    .select({ id: nodes.id, name: nodes.name })
    .from(nodes)
    .where(
      and(
        eq(nodes.ownerId, me.id),
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
    .where(
      and(
        eq(nodes.id, id),
        or(
          eq(nodes.ownerId, me.id),
          exists(
            db
              .select()
              .from(shares)
              .where(
                and(eq(shares.nodeId, nodes.id), eq(shares.granteeId, me.id))
              )
          )
        )
      )
    )
  if (!row) return null
  const mine = row.ownerId === me.id

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
      : null,
    contents: contents && {
      folders: contents.folders,
      files: contents.files,
      bytes: Number(contents.bytes),
    },
    shares: mine ? shareCount : null,
  }
}

export type Details = NonNullable<Awaited<ReturnType<typeof getDetails>>>

// Nodes the user can see: their own, or shared with them.
const visible = (userId: string, ids: string[]) =>
  and(
    inArray(nodes.id, ids),
    or(
      eq(nodes.ownerId, userId),
      exists(
        db
          .select()
          .from(shares)
          .where(and(eq(shares.nodeId, nodes.id), eq(shares.granteeId, userId)))
      )
    )
  )

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
    const allowed = await db
      .select({ id: nodes.id })
      .from(nodes)
      .where(visible(me.id, ids))
    if (allowed.length)
      await db
        .insert(nodeTags)
        .values(allowed.map((n) => ({ nodeId: n.id, tagId })))
        .onConflictDoNothing()
  } else {
    await db
      .delete(nodeTags)
      .where(and(eq(nodeTags.tagId, tagId), inArray(nodeTags.nodeId, ids)))
  }
  refresh()
}
