import { z } from "zod"

import { json } from "@/lib/api"
import { envApi } from "@/lib/secrets/env-route"
import { deletePush, getPush, runPush, savePush } from "@/lib/secrets/push"
import { SecretsError } from "@/lib/secrets/service"

type P = { id: string; envId: string }

export const GET = envApi<P>("admin", async (_c, _req, p, log, t) => {
  if (t) await log("secrets_push_list")
  return Response.json({ push: await getPush(p.envId) })
})

// Saves the target. Leave privateKey out to keep the one already stored.
export const PUT = envApi<P>("admin", async (c, req, p, log) => {
  const b = await json(
    req,
    z.object({
      host: z.string().max(200),
      port: z.number().int().default(22),
      username: z.string().max(60),
      path: z.string().max(300),
      privateKey: z.string().max(20_000).optional(),
      keyId: z.string().uuid().optional(),
      postCommand: z.string().max(500).default(""),
      auto: z.boolean().default(false),
      forgetHostKey: z.boolean().optional(),
    })
  )
  if (b instanceof Response) return b
  await savePush(c, p.envId, b)
  await log("secrets_push_save", `${b.username}@${b.host}:${b.path}`)
  return Response.json({ ok: true })
})

// Push now. The one call a read-write machine token with this env may make (a deploy step):
// it runs the stored target and can't change it or read anything back.
export const POST = envApi<P>(
  "admin",
  async (_c, _req, p, log) => {
    const r = await runPush(p.envId).catch((e: Error) => ({ ok: false, message: e.message }))
    await log("secrets_push_run", r.ok ? "pushed" : `failed: ${r.message.slice(0, 120)}`)
    if (!r.ok) throw new SecretsError(502, r.message)
    return Response.json(r)
  },
  { machine: true }
)

export const DELETE = envApi<P>("admin", async (_c, _req, p, log) => {
  await deletePush(p.envId)
  await log("secrets_push_remove")
  return Response.json({ ok: true })
})
