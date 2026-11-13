import { z } from "zod"

import { query, uuid } from "@/lib/api"
import { projectRoute } from "@/lib/secrets/guard"
import { timeline } from "@/lib/secrets/history"

// Changes to an environment (or one folder of it), newest first.
export const GET = projectRoute("viewer", async (c, req) => {
  const q = query(req, z.object({ envId: uuid, folderId: uuid.optional() }))
  if (q instanceof Response) return q
  return Response.json({ moments: await timeline(c, q.envId, q.folderId ?? null) })
})
