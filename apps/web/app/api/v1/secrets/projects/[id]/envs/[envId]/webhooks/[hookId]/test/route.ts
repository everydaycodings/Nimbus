import { envApi } from "@/lib/secrets/env-route"
import { testHook } from "@/lib/secrets/webhooks"

export const POST = envApi<{ id: string; envId: string; hookId: string }>("admin", async (_c, _req, p, log) => {
  const r = await testHook(p.envId, p.hookId)
  await log("secrets_webhook_test", r.status === "delivered" ? "delivered" : `failed: ${r.message ?? r.httpStatus}`)
  return Response.json(r)
})
