"use server"

import * as svc from "@/lib/services/comments"
import { requireMember } from "@/lib/session"

// The web's twin of /api/v1/files/{id}/comments and /api/v1/comments/{id}.
export async function getComments(id: string) {
  return svc.listComments(await requireMember(), id)
}

export async function addComment(
  id: string,
  input: { body: string; parentId?: string; atSeconds?: number; page?: number }
) {
  return svc.addComment(await requireMember(), id, input)
}

export async function editComment(commentId: string, body: string) {
  return svc.editComment(await requireMember(), commentId, body)
}

export async function deleteComment(commentId: string) {
  return svc.deleteComment(await requireMember(), commentId)
}

export async function resolveThread(commentId: string, resolved: boolean) {
  return svc.resolveThread(await requireMember(), commentId, Boolean(resolved))
}

export async function reactTo(commentId: string, emoji: string, on: boolean) {
  return svc.react(await requireMember(), commentId, emoji, Boolean(on))
}
