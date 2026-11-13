import { uuid } from "@/lib/api"
import { projectRoute } from "@/lib/secrets/guard"
import { deleteTemplate } from "@/lib/secrets/pki"

export const DELETE = projectRoute<{ caId: string; tid: string }>("admin", async (c, _r, p) => {
  await deleteTemplate(c, uuid.parse(p.caId), uuid.parse(p.tid))
  return Response.json({})
})
