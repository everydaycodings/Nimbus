import { z } from "zod"

import { json, uuid } from "@/lib/api"
import { startOrder } from "@/lib/secrets/acme"
import { projectRoute } from "@/lib/secrets/guard"

// Starts an order and returns at once; the web polls GET /acme for its progress.
export const POST = projectRoute("developer", async (c, req) => {
  const b = await json(req, z.object({ accountId: uuid, name: z.string().max(80).default(""), domains: z.array(z.string().max(253)).max(20), challenge: z.string().max(10), credId: uuid.nullable().default(null), autoRenew: z.boolean().default(true) }))
  if (b instanceof Response) return b
  return Response.json({ id: await startOrder(c, b) })
})
