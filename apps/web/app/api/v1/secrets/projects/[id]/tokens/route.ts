import { z } from "zod"

import { fail, json, uuid } from "@/lib/api"
import { audit } from "@/lib/audit"
import { projectRoute } from "@/lib/secrets/guard"
import { createMachineToken, listMachineTokens, TokenError } from "@/lib/secrets/tokens"

export const GET = projectRoute("admin", async (c) => Response.json({ tokens: await listMachineTokens(c.projectId) }))

// Makes a machine token. The token itself is in this response only.
export const POST = projectRoute("admin", async (c, req) => {
  const b = await json(
    req,
    z.object({
      name: z.string().max(60),
      envIds: z.array(uuid).max(100),
      path: z.string().max(200).default(""),
      access: z.enum(["ro", "rw"]).default("ro"),
      expiresInDays: z.number().int().min(1).max(3650).nullable().default(null),
      ipAllow: z.array(z.string().max(60)).max(20).default([]),
    })
  )
  if (b instanceof Response) return b
  try {
    const r = await createMachineToken(c.projectId, c.userId, b)
    await audit("secrets_token_create", { detail: `${b.name} (${b.access})` })
    return Response.json(r)
  } catch (e) {
    if (e instanceof TokenError) return fail(e.status, "refused", e.message)
    throw e
  }
})
