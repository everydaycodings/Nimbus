import { uuid } from "@/lib/api"
import { projectRoute } from "@/lib/secrets/guard"
import { deleteCa } from "@/lib/secrets/pki"

export const DELETE = projectRoute<{ caId: string }>("admin", async (c, _r, p) => {
  await deleteCa(c, uuid.parse(p.caId))
  return Response.json({})
})
