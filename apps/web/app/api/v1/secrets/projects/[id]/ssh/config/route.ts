import { projectRoute } from "@/lib/secrets/guard"
import { exportConfig } from "@/lib/secrets/ssh"

// ~/.ssh/config text for one host (?host=id) or all of them.
export const GET = projectRoute("viewer", async (c, req) => {
  const text = await exportConfig(c, new URL(req.url).searchParams.get("host") ?? undefined)
  return new Response(text, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } })
})
