import { z } from "zod"

import { json, uuid } from "@/lib/api"
import { projectRoute } from "@/lib/secrets/guard"
import { createFolder } from "@/lib/secrets/service"

export const POST = projectRoute("developer", async (c, req) => {
  const b = await json(
    req,
    z.object({ envId: uuid, parentId: uuid.nullable().default(null), name: z.string() })
  )
  if (b instanceof Response) return b
  return Response.json({ id: await createFolder(c, b.envId, b.parentId, b.name) })
}, { grant: true })
