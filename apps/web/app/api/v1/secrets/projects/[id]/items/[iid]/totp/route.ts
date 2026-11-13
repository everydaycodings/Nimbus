import { z } from "zod"

import { query, uuid } from "@/lib/api"
import { projectRoute } from "@/lib/secrets/guard"
import { codeOf } from "@/lib/secrets/items"

// The current code without revealing the secret. ?first=1 on the first call writes one audit line.
export const GET = projectRoute<{ iid: string }>("developer", async (c, req, p) => {
  const q = query(req, z.object({ first: z.string().optional() }))
  if (q instanceof Response) return q
  return Response.json(await codeOf(c, uuid.parse(p.iid), Boolean(q.first)))
})
