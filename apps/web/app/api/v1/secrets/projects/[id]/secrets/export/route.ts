import { z } from "zod"

import { json, uuid } from "@/lib/api"
import { audit } from "@/lib/audit"
import { projectRoute } from "@/lib/secrets/guard"
import { exportPairs, exportText } from "@/lib/secrets/service"

const TYPES = { env: "text/plain", json: "application/json", yaml: "text/yaml" }

// A folder, or the chosen ids, as .env, JSON or YAML with references expanded.
export const POST = projectRoute("viewer", async (c, req) => {
  const b = await json(
    req,
    z.object({
      format: z.enum(["env", "json", "yaml"]),
      envId: uuid.optional(),
      folderId: uuid.nullable().default(null),
      ids: z.array(uuid).max(1000).optional(),
    })
  )
  if (b instanceof Response) return b
  const where = b.ids ? { ids: b.ids } : b.envId ? { envId: b.envId, folderId: b.folderId } : null
  if (!where) return Response.json({ error: "bad-request", message: "Say what to export." }, { status: 400 })
  const pairs = await exportPairs(c, where, { expand: true, own: true })
  await audit("secrets_export", { detail: `${pairs.length} secrets as ${b.format}` })
  return new Response(exportText(pairs, b.format), {
    headers: { "content-type": `${TYPES[b.format]}; charset=utf-8`, "cache-control": "no-store" },
  })
})
