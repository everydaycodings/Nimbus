import { z } from "zod"

import { json } from "@/lib/api"
import { envApi } from "@/lib/secrets/env-route"
import { createHook, listHooks } from "@/lib/secrets/webhooks"

type P = { id: string; envId: string }

export const GET = envApi<P>("admin", async (_c, _req, p, log, t) => {
  if (t) await log("secrets_webhook_list")
  return Response.json(await listHooks(p.envId))
})

// The signing secret is in this response only.
export const POST = envApi<P>("admin", async (c, req, p, log) => {
  const b = await json(req, z.object({ url: z.string().max(500) }))
  if (b instanceof Response) return b
  const r = await createHook(c, p.envId, b.url)
  await log("secrets_webhook_add", b.url)
  return Response.json(r)
})
