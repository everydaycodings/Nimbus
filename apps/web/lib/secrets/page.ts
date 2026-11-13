import "server-only"

import { notFound } from "next/navigation"

import { projectCtx } from "./service"
import { unlockState } from "./unlock"
import { requireMember } from "@/lib/session"

// For pages: the member and their project, null while locked (the layout shows
// the unlock screen), a 404 for a project they aren't in.
export async function pageProject(projectId: string) {
  const me = await requireMember()
  const st = await unlockState()
  if (!st?.unlocked) return null
  const c = await projectCtx(me.id, projectId)
  if (!c) notFound()
  return { me, c }
}

export async function pageUnlocked() {
  const me = await requireMember()
  const st = await unlockState()
  return st?.unlocked ? me : null
}
