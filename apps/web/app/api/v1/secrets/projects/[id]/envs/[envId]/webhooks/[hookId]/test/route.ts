import { projectRoute } from "@/lib/secrets/guard"
import { requireEnv } from "@/lib/secrets/service"
import { testHook } from "@/lib/secrets/webhooks"

export const POST = projectRoute<{ envId: string; hookId: string }>("admin", async (c, _req, p) => {
  await requireEnv(c, p.envId)
  return Response.json(await testHook(p.envId, p.hookId))
})
