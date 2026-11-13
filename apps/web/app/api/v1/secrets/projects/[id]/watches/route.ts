import { z } from "zod"

import { json } from "@/lib/api"
import { projectRoute } from "@/lib/secrets/guard"
import { addWatch, listWatches } from "@/lib/secrets/watch"

export const GET = projectRoute("viewer", async (c) => Response.json({ watches: await listWatches(c) }))

export const POST = projectRoute("developer", async (c, req) => {
  const b = await json(req, z.object({ host: z.string().max(300), port: z.number().int().default(443) }))
  if (b instanceof Response) return b
  return Response.json(await addWatch(c, b.host, b.port))
})
