import { uuid } from "@/lib/api"
import { deleteAccount } from "@/lib/secrets/acme"
import { projectRoute } from "@/lib/secrets/guard"

export const DELETE = projectRoute<{ aid: string }>("admin", async (c, _r, p) => {
  await deleteAccount(c, uuid.parse(p.aid))
  return Response.json({})
})
