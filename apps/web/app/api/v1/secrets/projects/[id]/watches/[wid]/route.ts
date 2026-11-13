import { uuid } from "@/lib/api"
import { projectRoute } from "@/lib/secrets/guard"
import { deleteWatch } from "@/lib/secrets/watch"

export const DELETE = projectRoute<{ wid: string }>("developer", async (c, _r, p) => {
  await deleteWatch(c, uuid.parse(p.wid))
  return Response.json({})
})
