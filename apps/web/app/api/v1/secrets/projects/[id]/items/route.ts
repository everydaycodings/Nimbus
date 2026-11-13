import { z } from "zod"

import { json } from "@/lib/api"
import { projectRoute } from "@/lib/secrets/guard"
import { createItem, listItems } from "@/lib/secrets/items"

export const GET = projectRoute("viewer", async (c) => Response.json({ items: await listItems(c) }))

export const POST = projectRoute("developer", async (c, req) => {
  const b = await json(req, z.object({ kind: z.string().max(10), name: z.string().max(80), data: z.record(z.string(), z.unknown()), expiresAt: z.string().max(40).nullable().optional() }))
  if (b instanceof Response) return b
  return Response.json(await createItem(c, b))
})
