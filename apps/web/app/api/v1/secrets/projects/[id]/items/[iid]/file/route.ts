import { uuid } from "@/lib/api"
import { projectRoute } from "@/lib/secrets/guard"
import { fileOf } from "@/lib/secrets/items"

export const GET = projectRoute<{ iid: string }>("developer", async (c, _r, p) => {
  const f = await fileOf(c, uuid.parse(p.iid))
  return new Response(new Uint8Array(f.body), { headers: { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${encodeURIComponent(f.filename)}"`, "cache-control": "no-store" } })
})
