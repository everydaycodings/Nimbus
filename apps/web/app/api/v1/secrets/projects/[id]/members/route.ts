import { z } from "zod"

import { json, uuid } from "@/lib/api"
import { audit } from "@/lib/audit"
import { projectRoute } from "@/lib/secrets/guard"
import { addMember, listMembers } from "@/lib/secrets/members"

export const GET = projectRoute("admin", async (c) => Response.json({ members: await listMembers(c) }))

export const POST = projectRoute("admin", async (c, req) => {
  const b = await json(
    req,
    z.object({
      email: z.string().max(200),
      role: z.string(),
      envIds: z.array(uuid).max(100).nullable().default(null),
    })
  )
  if (b instanceof Response) return b
  const u = await addMember(c, b.email, b.role, b.envIds)
  await audit("secrets_member_add", { targetId: u.id, detail: `${b.role}${b.envIds ? `, ${b.envIds.length} environments` : ""}` })
  return Response.json({ ok: true })
})
