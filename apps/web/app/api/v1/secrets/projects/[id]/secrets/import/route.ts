import { z } from "zod"

import { fail, json, uuid } from "@/lib/api"
import { audit } from "@/lib/audit"
import { parseAny, planImport } from "@/lib/secrets/format"
import { names } from "@/lib/secrets/format"
import { projectRoute } from "@/lib/secrets/guard"
import { applyOps, existingValues } from "@/lib/secrets/service"

const at = { envId: uuid, folderId: uuid.nullable().default(null) }
const body = z.discriminatedUnion("mode", [
  // Parses .env / JSON / YAML text and says what each key would do. No existing value leaves the server.
  z.object({ mode: z.literal("preview"), ...at, text: z.string().max(2_000_000), name: z.string().max(200).optional() }),
  // Saves the rows the person kept (the ones not set to Skip).
  z.object({
    mode: z.literal("apply"),
    ...at,
    items: z.array(z.object({ key: z.string().max(200), value: z.string().max(100_000) })).max(2000),
  }),
])

export const POST = projectRoute("developer", async (c, req) => {
  const b = await json(req, body)
  if (b instanceof Response) return b
  if (b.mode === "preview") {
    const parsed = parseAny(b.text, b.name)
    if (!parsed.pairs.length)
      return fail(400, "empty", parsed.errors[0] ?? "No KEY=value pairs found.")
    const here = await existingValues(c, b.envId, b.folderId)
    return Response.json({ rows: planImport(parsed.pairs, here), errors: parsed.errors })
  }
  const r = await applyOps(c, b.envId, b.folderId, b.items, [], "merge")
  await audit("secrets_import", {
    detail: `${r.env}: ${r.created.length} new, ${r.updated.length} changed (${names([...r.created, ...r.updated])})`,
  })
  return Response.json(r)
})
