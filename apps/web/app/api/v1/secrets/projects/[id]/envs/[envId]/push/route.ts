import { z } from "zod"

import { fail, json } from "@/lib/api"
import { audit } from "@/lib/audit"
import { projectRoute } from "@/lib/secrets/guard"
import { deletePush, getPush, runPush, savePush } from "@/lib/secrets/push"
import { requireEnv } from "@/lib/secrets/service"

type P = { envId: string }

export const GET = projectRoute<P>("admin", async (c, _req, p) => {
  await requireEnv(c, p.envId)
  return Response.json({ push: await getPush(p.envId) })
})

// Saves the target. Leave privateKey out to keep the one already stored.
export const PUT = projectRoute<P>("admin", async (c, req, p) => {
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
  await requireEnv(c, p.envId)
  await savePush(c, p.envId, b)
  await audit("secrets_push_save", { detail: `${b.username}@${b.host}:${b.path}` })
  return Response.json({ ok: true })
})

// Push now.
export const POST = projectRoute<P>("admin", async (c, _req, p) => {
  await requireEnv(c, p.envId)
  const r = await runPush(p.envId).catch((e: Error) => ({ ok: false, message: e.message }))
  await audit("secrets_push_run", { detail: r.ok ? "pushed" : `failed: ${r.message.slice(0, 120)}` })
  return r.ok ? Response.json(r) : fail(502, "push-failed", r.message)
})

export const DELETE = projectRoute<P>("admin", async (c, _req, p) => {
  await requireEnv(c, p.envId)
  await deletePush(p.envId)
  await audit("secrets_push_remove")
  return Response.json({ ok: true })
})
