import { z } from "zod"

import { fail, json, uuid } from "@/lib/api"
import { askable, decideAccess, listAccess, requestAccess } from "@/lib/secrets/access"
import { projectRoute } from "@/lib/secrets/guard"

// Admins see everyone's requests; a member sees their own and what they could ask for.
export const GET = projectRoute("viewer", async (c) =>
  Response.json({ requests: await listAccess(c), envs: await askable(c) })
)

const body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    envId: uuid,
    role: z.enum(["viewer", "developer"]),
    minutes: z.number().int(),
    reason: z.string().max(500),
  }),
  z.object({ action: z.enum(["approve", "deny", "revoke"]), id: uuid }),
])

export const POST = projectRoute("viewer", async (c, req) => {
  const b = await json(req, body)
  if (b instanceof Response) return b
  if (b.action === "create") {
    await requestAccess(c, b.envId, b.role, b.minutes, b.reason)
    return Response.json({ ok: true })
  }
  if (c.role !== "admin") return fail(403, "forbidden", "Only a project admin can answer access requests.")
  await decideAccess(c, b.id, b.action)
  return Response.json({ ok: true })
})
