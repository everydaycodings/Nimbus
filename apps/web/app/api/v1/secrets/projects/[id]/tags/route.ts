import { projectRoute } from "@/lib/secrets/guard"
import { listTags } from "@/lib/secrets/service"

export const GET = projectRoute("viewer", async (c) =>
  Response.json({ tags: await listTags(c) })
)
