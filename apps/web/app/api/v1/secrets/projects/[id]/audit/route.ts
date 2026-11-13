import { z } from "zod"

import { query } from "@/lib/api"
import { projectAudit } from "@/lib/secrets/audit-log"
import { projectRoute } from "@/lib/secrets/guard"

// Project admins: every Secrets event in this project, filterable.
export const GET = projectRoute("admin", async (c, req) => {
  const q = query(
    req,
    z.object({
      actor: z.string().max(100).optional(),
      action: z.string().max(60).optional(),
      env: z.string().max(80).optional(),
      from: z.string().max(10).optional(),
      to: z.string().max(10).optional(),
      before: z.string().max(40).optional(),
    })
  )
  if (q instanceof Response) return q
  return Response.json(await projectAudit(c, q))
})
