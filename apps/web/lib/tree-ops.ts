// Tree changes on behalf of a user, shared by the web's server actions and
// WebDAV. Each checks access itself and returns { error } in words people read.
import "server-only"

import { and, eq, inArray, isNull, sql } from "drizzle-orm"

import { folderOwner, ownerIfAll } from "@/lib/access"
import { db } from "@/lib/db"
import { nodes } from "@/lib/db/schema"
import { UUID } from "@/lib/files"
import { notifyEdit } from "@/lib/notify"
import { trashNodes } from "@/lib/tree"
import { isClash } from "@/lib/uploads"

export type Result = { error?: string }

export const CLASH = "Something with that name is already in this folder."
export const GONE = "That folder is gone. Refresh and try again."
export const NOT_ALLOWED =
  "You can't change that. Ask its owner for edit access."

export function cleanName(raw: string) {
  const name = raw.trim()
  if (!name) return { error: "Enter a name." }
  if (name.length > 255) return { error: "Keep names under 255 characters." }
  if (name === "." || name === ".." || /[/\\\0]/.test(name))
    return { error: "Names can't be . or .. or contain / or \\." }
  return { name }
}

export function cleanIds(ids: string[]) {
  return Array.isArray(ids)
    ? ids.filter((id) => UUID.test(id)).slice(0, 1000)
    : []
}

export const owned = (ownerId: string, ids: string[]) =>
  and(eq(nodes.ownerId, ownerId), inArray(nodes.id, ids))

export async function createFolderAs(
  userId: string,
  parentId: string | null,
  raw: string
): Promise<Result & { id?: string }> {
  const clean = cleanName(raw)
  if ("error" in clean) return clean
  const owner = await folderOwner(userId, parentId)
  if (!owner) return { error: GONE }
  let id: string
  try {
    ;[{ id }] = await db
      .insert(nodes)
      .values({ ownerId: owner, parentId, kind: "folder", name: clean.name })
      .returning({ id: nodes.id })
  } catch (e) {
    if (isClash(e)) return { error: CLASH }
    throw e
  }
  if (owner !== userId) await notifyEdit(userId, parentId!)
  return { id }
}

export async function renameAs(
  userId: string,
  id: string,
  raw: string
): Promise<Result> {
  const clean = cleanName(raw)
  if ("error" in clean) return clean
  const ids = cleanIds([id])
  const owner = await ownerIfAll(userId, ids, "editor")
  if (!owner) return { error: NOT_ALLOWED }
  try {
    await db
      .update(nodes)
      .set({ name: clean.name, updatedAt: new Date() })
      .where(and(owned(owner, ids), isNull(nodes.trashedAt)))
  } catch (e) {
    if (isClash(e)) return { error: CLASH }
    throw e
  }
  if (owner !== userId) await notifyEdit(userId, ids[0])
  return {}
}

// Things move only within one owner's tree, so nothing leaves a shared folder
// by moving: editors can only reach folders that owner shared. `name` renames
// in the same step (WebDAV MOVE does both at once).
export async function moveAs(
  userId: string,
  rawIds: string[],
  parentId: string | null,
  name?: string
): Promise<Result> {
  const ids = cleanIds(rawIds)
  const owner = await ownerIfAll(userId, ids, "editor")
  if (!owner) return { error: NOT_ALLOWED }
  const target = await folderOwner(userId, parentId)
  if (!target) return { error: GONE }
  if (target !== owner)
    return {
      error:
        owner === userId
          ? "Your files can't go into a folder someone shared with you."
          : "Shared items can only move between folders from the same owner.",
    }
  let rename: { name?: string } = {}
  if (name !== undefined) {
    const clean = cleanName(name)
    if ("error" in clean) return clean
    rename = { name: clean.name }
  }
  if (parentId) {
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
      .set({ parentId, ...rename, updatedAt: new Date() })
      .where(and(owned(owner, ids), isNull(nodes.trashedAt)))
  } catch (e) {
    if (isClash(e))
      return {
        error: "Something with the same name is already in that folder.",
      }
    throw e
  }
  if (owner !== userId && parentId) await notifyEdit(userId, parentId)
  return {}
}

// Editors' trash lands in the owner's trash.
export async function trashAs(
  userId: string,
  rawIds: string[]
): Promise<Result> {
  const ids = cleanIds(rawIds)
  const owner = await ownerIfAll(userId, ids, "editor")
  if (!owner) return { error: NOT_ALLOWED }
  await trashNodes(db, owner, ids)
  if (owner !== userId) await notifyEdit(userId, ids[0])
  return {}
}
