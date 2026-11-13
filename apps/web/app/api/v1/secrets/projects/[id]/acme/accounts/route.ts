import { z } from "zod"

import { json } from "@/lib/api"
import { addAccount } from "@/lib/secrets/acme"
import { projectRoute } from "@/lib/secrets/guard"

export const POST = projectRoute("admin", async (c, req) => {
  const b = await json(req, z.object({ directory: z.string().max(300), email: z.string().max(200) }))
  if (b instanceof Response) return b
  await addAccount(c, b.directory, b.email)
  return Response.json({})
})
