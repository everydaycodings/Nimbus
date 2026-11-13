import { uuid } from "@/lib/api"
import { verifyOrder } from "@/lib/secrets/acme"
import { projectRoute } from "@/lib/secrets/guard"

export const POST = projectRoute<{ oid: string }>("developer", async (c, _r, p) => {
  await verifyOrder(c, uuid.parse(p.oid))
  return Response.json({})
})
