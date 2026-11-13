import { z } from "zod"

import { query } from "@/lib/api"
import { projectRoute } from "@/lib/secrets/guard"
import { search } from "@/lib/secrets/service"

// Key names, comments and tags. Values are never searched.
export const GET = projectRoute("viewer", async (c, req) => {
  const q = query(req, z.object({ q: z.string().trim().min(1).max(100) }))
  if (q instanceof Response) return q
  return Response.json({ results: await search(c, q.q) })
})
