import { z } from "zod"

import { json } from "@/lib/api"
import { audit } from "@/lib/audit"
import { projectRoute } from "@/lib/secrets/guard"
import { requireEnv } from "@/lib/secrets/service"
import { createHook, listHooks } from "@/lib/secrets/webhooks"

type P = { envId: string }

export const GET = projectRoute<P>("admin", async (c, _req, p) => {
  await requireEnv(c, p.envId)
  return Response.json(await listHooks(p.envId))
})

// The signing secret is in this response only.
export const POST = projectRoute<P>("admin", async (c, req, p) => {
  const b = await json(req, z.object({ url: z.string().max(500) }))
  if (b instanceof Response) return b
  await requireEnv(c, p.envId)
  const r = await createHook(c, p.envId, b.url)
  await audit("secrets_webhook_add", { detail: b.url })
  return Response.json(r)
})
