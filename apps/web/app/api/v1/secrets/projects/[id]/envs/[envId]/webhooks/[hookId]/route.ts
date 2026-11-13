import { z } from "zod"

import { json } from "@/lib/api"
import { audit } from "@/lib/audit"
import { projectRoute } from "@/lib/secrets/guard"
import { requireEnv } from "@/lib/secrets/service"
import { deleteHook, updateHook } from "@/lib/secrets/webhooks"

type P = { envId: string; hookId: string }

export const PATCH = projectRoute<P>("admin", async (c, req, p) => {
  const b = await json(req, z.object({ url: z.string().max(500).optional(), enabled: z.boolean().optional() }))
  if (b instanceof Response) return b
  await requireEnv(c, p.envId)
  await updateHook(p.envId, p.hookId, b)
  return Response.json({ ok: true })
})

export const DELETE = projectRoute<P>("admin", async (c, _req, p) => {
  await requireEnv(c, p.envId)
  await deleteHook(p.envId, p.hookId)
  await audit("secrets_webhook_remove")
  return Response.json({ ok: true })
})
