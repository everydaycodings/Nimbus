import { z } from "zod"

import { json, uuid } from "@/lib/api"
import { projectRoute } from "@/lib/secrets/guard"
import { rollback } from "@/lib/secrets/history"

// preview: what a rollback to `at` would change. apply: writes it as new versions,
// or as a change request in a protected environment.
export const POST = projectRoute("viewer", async (c, req) => {
  const b = await json(
    req,
    z.object({ envId: uuid, folderId: uuid.nullable().default(null), at: z.string().max(40), apply: z.boolean().default(false) })
  )
  if (b instanceof Response) return b
  return Response.json(await rollback(c, b.envId, b.folderId, b.at, b.apply))
})
