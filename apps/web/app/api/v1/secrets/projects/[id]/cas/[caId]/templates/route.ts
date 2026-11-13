import { z } from "zod"

import { json, uuid } from "@/lib/api"
import { projectRoute } from "@/lib/secrets/guard"
import { addTemplate } from "@/lib/secrets/pki"

export const POST = projectRoute<{ caId: string }>("admin", async (c, req, p) => {
  const b = await json(req, z.object({ name: z.string().max(80), kind: z.enum(["server", "client"]), sanPatterns: z.array(z.string().max(200)).max(50), maxTtlDays: z.number().int() }))
  if (b instanceof Response) return b
  await addTemplate(c, uuid.parse(p.caId), b)
  return Response.json({})
})
