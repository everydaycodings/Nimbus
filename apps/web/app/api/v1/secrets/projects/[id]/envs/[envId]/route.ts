import { z } from "zod"

import { json } from "@/lib/api"
import { audit } from "@/lib/audit"
import { projectRoute } from "@/lib/secrets/guard"
import { updateEnvPolicy } from "@/lib/secrets/policies"
import { deleteEnv, renameEnv } from "@/lib/secrets/service"

type P = { envId: string }

// A new name, and/or the environment's protection: { policy: { protected, approvalsRequired, approverIds, adminBypass } }.
export const PATCH = projectRoute<P>("admin", async (c, req, p) => {
  const b = await json(
    req,
    z.object({
      name: z.string().optional(),
      policy: z
        .object({
          protected: z.boolean(),
          approvalsRequired: z.number().int(),
          approverIds: z.array(z.string().max(100)).max(100).nullable(),
          adminBypass: z.boolean(),
        })
        .optional(),
    })
  )
  if (b instanceof Response) return b
  if (b.name !== undefined) await renameEnv(c, p.envId, b.name)
  if (b.policy) await updateEnvPolicy(c, p.envId, b.policy)
  return Response.json({ ok: true })
})

export const DELETE = projectRoute<P>("admin", async (c, _, p) => {
  await deleteEnv(c, p.envId)
  await audit("secrets_env_delete", { detail: p.envId })
  return Response.json({ ok: true })
})
