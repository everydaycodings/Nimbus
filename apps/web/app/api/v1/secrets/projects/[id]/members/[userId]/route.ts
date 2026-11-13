import { z } from "zod"

import { json, uuid } from "@/lib/api"
import { audit } from "@/lib/audit"
import { projectRoute } from "@/lib/secrets/guard"
import { removeMember, updateMember } from "@/lib/secrets/members"

export const PATCH = projectRoute<{ userId: string }>("admin", async (c, req, p) => {
  const b = await json(
    req,
    z.object({ role: z.string(), envIds: z.array(uuid).max(100).nullable().default(null) })
  )
  if (b instanceof Response) return b
  await updateMember(c, p.userId, b.role, b.envIds)
  await audit("secrets_member_change", { targetId: p.userId, detail: b.role })
  return Response.json({ ok: true })
})

export const DELETE = projectRoute<{ userId: string }>("admin", async (c, _req, p) => {
  await removeMember(c, p.userId)
  await audit("secrets_member_remove", { targetId: p.userId })
  return Response.json({ ok: true })
})
