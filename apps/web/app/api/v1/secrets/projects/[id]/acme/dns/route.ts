import { z } from "zod"

import { json } from "@/lib/api"
import { addDnsCred } from "@/lib/secrets/acme"
import { projectRoute } from "@/lib/secrets/guard"

// Credentials go in sealed and never come back out.
export const POST = projectRoute("admin", async (c, req) => {
  const b = await json(req, z.object({ name: z.string().max(60), provider: z.string().max(20), creds: z.record(z.string(), z.string().max(500)) }))
  if (b instanceof Response) return b
  await addDnsCred(c, b.name, b.provider, b.creds)
  return Response.json({})
})
