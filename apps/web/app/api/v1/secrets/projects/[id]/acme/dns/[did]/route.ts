import { uuid } from "@/lib/api"
import { deleteDnsCred } from "@/lib/secrets/acme"
import { projectRoute } from "@/lib/secrets/guard"

export const DELETE = projectRoute<{ did: string }>("admin", async (c, _r, p) => {
  await deleteDnsCred(c, uuid.parse(p.did))
  return Response.json({})
})
