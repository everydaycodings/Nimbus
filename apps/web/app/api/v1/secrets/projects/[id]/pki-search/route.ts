import { z } from "zod"

import { query } from "@/lib/api"
import { projectRoute } from "@/lib/secrets/guard"
import { itemNames } from "@/lib/secrets/items"
import { certNames } from "@/lib/secrets/pki"

// Certificate and item names only; nothing inside them is searched.
export const GET = projectRoute("viewer", async (c, req) => {
  const q = query(req, z.object({ q: z.string().trim().min(1).max(100) }))
  if (q instanceof Response) return q
  return Response.json({ items: await itemNames(c, q.q), certs: await certNames(c, q.q) })
})
