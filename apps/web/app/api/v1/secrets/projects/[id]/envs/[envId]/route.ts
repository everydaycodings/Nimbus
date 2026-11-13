import { z } from "zod"

import { json } from "@/lib/api"
import { audit } from "@/lib/audit"
import { projectRoute } from "@/lib/secrets/guard"
import { deleteEnv, renameEnv } from "@/lib/secrets/service"

type P = { envId: string }

export const PATCH = projectRoute<P>("admin", async (c, req, p) => {
  const b = await json(req, z.object({ name: z.string() }))
  if (b instanceof Response) return b
  await renameEnv(c, p.envId, b.name)
  return Response.json({ ok: true })
})

export const DELETE = projectRoute<P>("admin", async (c, _, p) => {
  await deleteEnv(c, p.envId)
  await audit("secrets_env_delete", { detail: p.envId })
  return Response.json({ ok: true })
})
