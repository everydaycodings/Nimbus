import { uuid } from "@/lib/api"
import { deleteOrder } from "@/lib/secrets/acme"
import { projectRoute } from "@/lib/secrets/guard"

export const DELETE = projectRoute<{ oid: string }>("developer", async (c, _r, p) => {
  await deleteOrder(c, uuid.parse(p.oid))
  return Response.json({})
})
