import { z } from "zod"

import { json } from "@/lib/api"
import { envApi } from "@/lib/secrets/env-route"
import { deleteHook, updateHook } from "@/lib/secrets/webhooks"

type P = { id: string; envId: string; hookId: string }

export const PATCH = envApi<P>("admin", async (_c, req, p, log) => {
  const b = await json(req, z.object({ url: z.string().max(500).optional(), enabled: z.boolean().optional() }))
  if (b instanceof Response) return b
  await updateHook(p.envId, p.hookId, b)
  await log("secrets_webhook_edit", [b.url, b.enabled === undefined ? "" : b.enabled ? "on" : "off"].filter(Boolean).join(", "))
  return Response.json({ ok: true })
})

export const DELETE = envApi<P>("admin", async (_c, _req, p, log) => {
  await deleteHook(p.envId, p.hookId)
  await log("secrets_webhook_remove")
  return Response.json({ ok: true })
})
