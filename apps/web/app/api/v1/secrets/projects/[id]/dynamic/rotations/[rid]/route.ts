import { json } from "@/lib/api"
import { deleteRotation, rotateNow, sessionLog, updateRotation } from "@/lib/secrets/dynamic"
import { rotSchema } from "@/lib/secrets/dyn-schemas"
import { projectRoute } from "@/lib/secrets/guard"

type P = { rid: string }

export const PATCH = projectRoute<P>("admin", async (c, req, p) => {
  const b = await json(req, rotSchema)
  if (b instanceof Response) return b
  await updateRotation(c, p.rid, b, sessionLog)
  return Response.json({})
})

export const DELETE = projectRoute<P>("admin", async (c, _req, p) => {
  await deleteRotation(c, p.rid, sessionLog)
  return Response.json({})
})

// "Rotate now".
export const POST = projectRoute<P>("admin", async (c, _req, p) => Response.json(await rotateNow(c, p.rid, sessionLog)))
