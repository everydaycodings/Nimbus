import { z } from "zod"

import { json, uuid } from "@/lib/api"
import { audit } from "@/lib/audit"
import { projectRoute } from "@/lib/secrets/guard"
import { setOverride } from "@/lib/secrets/service"

// My own value for a key (null removes it). Only I see or export it.
export const PUT = projectRoute("viewer", async (c, req) => {
  const b = await json(req, z.object({ id: uuid, value: z.string().max(100_000).nullable() }))
  if (b instanceof Response) return b
  const key = await setOverride(c, b.id, b.value)
  await audit("secrets_write", { detail: `${b.value === null ? "removed" : "set"} personal override of ${key}` })
  return Response.json({ ok: true })
})
