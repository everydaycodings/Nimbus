import { z } from "zod"

import { json, query, uuid } from "@/lib/api"
import { audit } from "@/lib/audit"
import { projectRoute } from "@/lib/secrets/guard"
import { restoreVersion, secretHistory, versionValues } from "@/lib/secrets/history"

// Versions of one secret: who, when, what kind of change. No values.
export const GET = projectRoute("viewer", async (c, req) => {
  const q = query(req, z.object({ secretId: uuid }))
  if (q instanceof Response) return q
  return Response.json(await secretHistory(c, q.secretId))
})

const body = z.discriminatedUnion("action", [
  // Old and current values for the diff. Logged.
  z.object({ action: z.literal("reveal"), secretId: uuid, ids: z.array(uuid).max(50) }),
  // Writes the old version as a new one (a change request in a protected environment).
  z.object({ action: z.literal("restore"), secretId: uuid, versionId: uuid }),
])

export const POST = projectRoute("viewer", async (c, req) => {
  const b = await json(req, body)
  if (b instanceof Response) return b
  if (b.action === "reveal") {
    const r = await versionValues(c, b.secretId, b.ids)
    await audit("secrets_reveal", { detail: `${r.key} (history)` })
    return Response.json(r)
  }
  return Response.json(await restoreVersion(c, b.secretId, b.versionId))
})
