import { json } from "@/lib/api"
import { rotSchema } from "@/lib/secrets/dyn-schemas"
import { createRotation, sessionLog } from "@/lib/secrets/dynamic"
import { projectRoute } from "@/lib/secrets/guard"

export const POST = projectRoute("admin", async (c, req) => {
  const b = await json(req, rotSchema)
  if (b instanceof Response) return b
  return Response.json(await createRotation(c, b, sessionLog))
})
