import { projectHealth } from "@/lib/secrets/health"
import { projectRoute } from "@/lib/secrets/guard"

export const GET = projectRoute("viewer", async (c, req) => {
  const days = Number(new URL(req.url).searchParams.get("oldDays"))
  return Response.json(await projectHealth(c, c.userId, Number.isFinite(days) && days >= 7 && days <= 1000 ? Math.round(days) : undefined), {
    headers: { "cache-control": "no-store" },
  })
})
