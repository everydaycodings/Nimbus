import { projectApi } from "@/lib/secrets/env-route"
import { listPushes } from "@/lib/secrets/push"

// Every environment's server push in the project (admins). The web shows them per environment.
export const GET = projectApi<{ id: string }>("admin", async (c, _req, _p, log) => {
  await log("secrets_push_list")
  return Response.json({ targets: await listPushes(c.projectId) })
})
