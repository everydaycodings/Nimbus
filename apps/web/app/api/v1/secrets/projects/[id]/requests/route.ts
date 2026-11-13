import { z } from "zod"

import { query } from "@/lib/api"
import { projectRoute } from "@/lib/secrets/guard"
import { listRequests } from "@/lib/secrets/requests"

export const GET = projectRoute("viewer", async (c, req) => {
  const q = query(req, z.object({ status: z.enum(["open", "all"]).default("open") }))
  if (q instanceof Response) return q
  return Response.json({ requests: await listRequests(c, q.status) })
})
