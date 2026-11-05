"use server"

import { refresh } from "next/cache"

import * as svc from "@/lib/services/shares"
import { requireMember } from "@/lib/session"

export type {
  LinkEvent,
  LinkInfo,
  LinkPatch,
  Person,
  ShareState,
} from "@/lib/services/shares"
type Result = svc.Result
type Role = svc.Role

export async function getShareState(
  nodeId: string
): Promise<svc.ShareState | null> {
  return svc.getShareState(await requireMember(), nodeId)
}

// Active members matching a name or email, for the add-people field.
export async function findMembers(q: string) {
  return svc.findMembers(await requireMember(), q)
}

// Shares with a member, or invites an email that has no account yet.
export async function shareWith(
  nodeId: string,
  target: string,
  role: Role
): Promise<Result> {
  const r = await svc.shareWith(await requireMember(), nodeId, target, role)
  if (!r.error) refresh()
  return r
}

export async function setShareRole(
  shareId: string,
  role: Role
): Promise<Result> {
  const r = await svc.setShareRole(await requireMember(), shareId, role)
  if (!r.error) refresh()
  return r
}

export async function removeShare(shareId: string): Promise<Result> {
  const r = await svc.removeShare(await requireMember(), shareId)
  if (!r.error) refresh()
  return r
}

export async function setAllowReshare(
  nodeId: string,
  on: boolean
): Promise<Result> {
  return svc.setAllowReshare(await requireMember(), nodeId, on)
}

export async function createLink(
  nodeId: string,
  opts: { name?: string; password?: string } = {}
): Promise<Result & { id?: string }> {
  const r = await svc.createLink(await requireMember(), nodeId, opts)
  if (!r.error) refresh()
  return r
}

export async function updateLink(
  shareId: string,
  patch: svc.LinkPatch
): Promise<Result> {
  const r = await svc.updateLink(await requireMember(), shareId, patch)
  if (!r.error) refresh()
  return r
}

export async function deleteLink(shareId: string): Promise<Result> {
  const r = await svc.deleteLink(await requireMember(), shareId)
  if (!r.error) refresh()
  return r
}

export async function listLinkEvents(
  shareId: string,
  limit = 20
): Promise<svc.LinkEvent[]> {
  return svc.listLinkEvents(await requireMember(), shareId, limit)
}

// Asks a member to take over an item. Nothing moves until they accept.
export async function offerOwnership(
  nodeId: string,
  toUserId: string
): Promise<Result> {
  const r = await svc.offerOwnership(await requireMember(), nodeId, toUserId)
  if (!r.error) refresh()
  return r
}

export async function cancelOwnershipOffer(nodeId: string): Promise<Result> {
  const r = await svc.cancelOwnershipOffer(await requireMember(), nodeId)
  refresh()
  return r
}

// The new owner takes the item into their My files with everything inside it.
// The old owner keeps edit access. Everything moves or nothing does.
export async function answerOwnership(
  nodeId: string,
  accept: boolean
): Promise<Result> {
  const r = await svc.answerOwnership(await requireMember(), nodeId, accept)
  refresh()
  return r
}
