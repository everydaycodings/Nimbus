"use server"

import { refresh } from "next/cache"

import { listActivity } from "@/lib/activity"
import { type TagColor } from "@/lib/db/schema"
import * as pr from "@/lib/services/point-restore"
import * as svc from "@/lib/services/files"
import { requireMember } from "@/lib/session"

export type { ActivityEvent } from "@/lib/activity"
export type { Details, TagSnapshot } from "@/lib/services/files"
export type { Applied, RestoreItem, RestorePreview } from "@/lib/services/point-restore"
type Result = svc.Result

export async function createFolder(
  parentId: string | null,
  raw: string
): Promise<Result> {
  const r = await svc.createFolder(await requireMember(), parentId, raw)
  if (r.error) return { error: r.error }
  refresh()
  return {}
}

export async function renameItem(id: string, raw: string): Promise<Result> {
  const r = await svc.renameItem(await requireMember(), id, raw)
  if (!r.error) refresh()
  return r
}

export async function moveItems(
  rawIds: string[],
  parentId: string | null
): Promise<Result> {
  const r = await svc.moveItems(await requireMember(), rawIds, parentId)
  if (!r.error) refresh()
  return r
}

export async function setStarred(rawIds: string[], starred: boolean) {
  await svc.setStarred(await requireMember(), rawIds, starred)
  refresh()
}

export async function trashItems(rawIds: string[]): Promise<Result> {
  const r = await svc.trashItems(await requireMember(), rawIds)
  if (!r.error) refresh()
  return r
}

// One transaction per item, so a name clash on one doesn't hold back the rest.
export async function restoreItems(rawIds: string[]): Promise<Result> {
  const r = await svc.restoreItems(await requireMember(), rawIds)
  // Items that could restore have, even when others couldn't.
  refresh()
  return r
}

export async function deleteForever(rawIds: string[]) {
  await svc.deleteForever(await requireMember(), rawIds)
  refresh()
}

export async function emptyTrash() {
  await svc.emptyTrash(await requireMember())
  refresh()
}

// For the move dialog's folder picker. Inside someone else's folder, its
// owner's subfolders.
export async function listFolders(parentId: string | null) {
  return svc.listFolders(await requireMember(), parentId)
}

// For the details panel.
export async function getDetails(id: string) {
  return svc.getDetails(await requireMember(), id)
}

// For the details panel: a page of who changed this, newest first. Null: not theirs to see.
export async function getActivity(id: string, offset = 0, limit = 10) {
  return listActivity((await requireMember()).id, id, {
    offset: Math.max(0, Math.floor(offset)) || 0,
    limit: Math.min(50, Math.max(1, Math.floor(limit))) || 10,
  })
}

// Makes a tag and puts it on `applyTo` in one go, the way "New tag…" is used.
export async function createTag(
  raw: string,
  color: TagColor,
  applyTo: string[]
): Promise<Result> {
  const r = await svc.createTag(await requireMember(), raw, color, applyTo)
  if (!r.error) refresh()
  return r
}

export async function tagItems(rawIds: string[], tagId: string, on: boolean) {
  await svc.tagItems(await requireMember(), rawIds, tagId, on)
  refresh()
}

// A name already used by another of your tags returns { merge } instead, so the
// UI can ask before calling mergeTags.
export async function renameTag(
  id: string,
  raw: string
): Promise<Result & { merge?: string }> {
  const r = await svc.renameTag(await requireMember(), id, raw)
  if (!r.error && !r.merge) refresh()
  return r
}

// Moves every item tagged `from` onto `into`, then drops `from`.
export async function mergeTags(from: string, into: string): Promise<Result> {
  const r = await svc.mergeTags(await requireMember(), from, into)
  if (!r.error) refresh()
  return r
}

export async function recolorTag(id: string, color: TagColor): Promise<Result> {
  const r = await svc.recolorTag(await requireMember(), id, color)
  if (!r.error) refresh()
  return r
}

// How many items carry the tag, for "Remove 'X' from N items?".
export async function tagCount(id: string): Promise<number> {
  return svc.tagCount(await requireMember(), id)
}

// Returns what restoreTag needs to undo it.
export async function deleteTag(id: string) {
  const r = await svc.deleteTag(await requireMember(), id)
  if (r) refresh()
  return r
}

export async function restoreTag(snap: svc.TagSnapshot): Promise<Result> {
  const r = await svc.restoreTag(await requireMember(), snap)
  if (!r.error) refresh()
  return r
}

// "Add shortcut to My files" for something shared with you.
export async function addShortcut(nodeId: string): Promise<Result> {
  const r = await svc.addShortcut(await requireMember(), nodeId)
  if (!r.error) refresh()
  return r
}

export async function removeShortcut(nodeId: string): Promise<Result> {
  const r = await svc.removeShortcut(await requireMember(), nodeId)
  refresh()
  return r
}

// Restore to a point in time. A null folder is all of My files; `at` is an ISO time.
export async function getRestoreWindow() {
  await requireMember()
  return pr.restoreWindow()
}

export async function previewRestore(folderId: string | null, at: string) {
  return pr.previewRestore(await requireMember(), folderId, new Date(at))
}

export async function applyRestore(folderId: string | null, at: string) {
  const r = await pr.applyRestore(await requireMember(), folderId, new Date(at))
  refresh()
  return r
}

export async function undoRestore(id: string) {
  const r = await pr.undoRestore(await requireMember(), id)
  refresh()
  return r
}
