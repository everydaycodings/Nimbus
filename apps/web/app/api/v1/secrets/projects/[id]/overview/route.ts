import { z } from "zod"

import { query } from "@/lib/api"
import { projectRoute } from "@/lib/secrets/guard"
import { overview } from "@/lib/secrets/service"

// Keys by environments for one folder path: which exist, which are empty.
export const GET = projectRoute("viewer", async (c, req) => {
  const q = query(req, z.object({ folder: z.string().default("") }))
  if (q instanceof Response) return q
  return Response.json(await overview(c, q.folder))
})
