import { z } from "zod"

import { json, uuid } from "@/lib/api"
import { projectRoute } from "@/lib/secrets/guard"
import { revokeCert } from "@/lib/secrets/pki"

export const POST = projectRoute<{ certId: string }>("admin", async (c, req, p) => {
  const b = await json(req, z.object({ reason: z.number().int().default(0) }))
  if (b instanceof Response) return b
  await revokeCert(c, uuid.parse(p.certId), b.reason)
  return Response.json({})
})
