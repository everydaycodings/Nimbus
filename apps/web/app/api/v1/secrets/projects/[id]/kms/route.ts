import { z } from "zod"

import { json } from "@/lib/api"
import { projectRoute } from "@/lib/secrets/guard"
import { createKmsKey, listKmsKeys } from "@/lib/secrets/kms-api"

export const GET = projectRoute("viewer", async (c) => Response.json({ keys: await listKmsKeys(c) }))

export const POST = projectRoute("admin", async (c, req) => {
  const b = await json(req, z.object({ name: z.string().max(64), kind: z.string().max(10) }))
  if (b instanceof Response) return b
  return Response.json({ id: await createKmsKey(c, b) })
})
