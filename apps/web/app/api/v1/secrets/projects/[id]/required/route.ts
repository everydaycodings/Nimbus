import { z } from "zod"

import { json, query } from "@/lib/api"
import { projectRoute } from "@/lib/secrets/guard"
import { listRequired, removeRequired, setRequired } from "@/lib/secrets/policies"

export const GET = projectRoute("viewer", async (c) => Response.json({ keys: await listRequired(c) }))

export const PUT = projectRoute("admin", async (c, req) => {
  const b = await json(
    req,
    z.object({ key: z.string().max(200), kind: z.enum(["any", "url", "int", "regex"]), pattern: z.string().max(200).nullable().default(null) })
  )
  if (b instanceof Response) return b
  await setRequired(c, b.key, b.kind, b.pattern)
  return Response.json({ keys: await listRequired(c) })
})

export const DELETE = projectRoute("admin", async (c, req) => {
  const q = query(req, z.object({ key: z.string().max(200) }))
  if (q instanceof Response) return q
  await removeRequired(c, q.key)
  return Response.json({ keys: await listRequired(c) })
})
