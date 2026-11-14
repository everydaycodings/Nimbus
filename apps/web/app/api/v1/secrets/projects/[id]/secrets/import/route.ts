import { z } from "zod"

import { fail, json, uuid } from "@/lib/api"
import { audit } from "@/lib/audit"
import { parseAny, planImport } from "@/lib/secrets/format"
import { names } from "@/lib/secrets/format"
import { projectRoute } from "@/lib/secrets/guard"
import { TOOLS, importFrom, type Tool } from "@/lib/secrets/importers"
import { readPux } from "@/lib/secrets/importers-zip"
import { createItem, listItems, updateItem } from "@/lib/secrets/items"
import { applyOps, existingValues } from "@/lib/secrets/service"

const at = { envId: uuid, folderId: uuid.nullable().default(null) }
const body = z.discriminatedUnion("mode", [
  // Parses .env / JSON / YAML text and says what each key would do. No existing value leaves the server.
  z.object({ mode: z.literal("preview"), ...at, text: z.string().max(2_000_000), name: z.string().max(200).optional() }),
  // The same, for an export from another tool. A .1pux comes as base64 (it's a zip).
  z.object({ mode: z.literal("preview-tool"), ...at, tool: z.enum(TOOLS), text: z.string().max(20_000_000).optional(), base64: z.string().max(40_000_000).optional(), name: z.string().max(200).optional() }),
  // Saves the rows the person kept (the ones not set to Skip).
  z.object({
    mode: z.literal("apply"),
    ...at,
    items: z.array(z.object({ key: z.string().max(200), value: z.string().max(100_000) })).max(2000),
    // Logins, API keys and notes from another tool, saved as Items; overwrite replaces one with the same name and type.
    entries: z
      .array(z.object({ kind: z.enum(["login", "api_key", "note"]), name: z.string().max(80), data: z.record(z.string(), z.string().max(30_000)), overwrite: z.boolean().default(false) }))
      .max(2000)
      .default([]),
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
  if (b.mode === "preview-tool") {
    let imported
    try {
      const text = b.base64 ? await readPux(Buffer.from(b.base64, "base64")) : (b.text ?? "")
      imported = importFrom(b.tool as Tool, text, b.name)
    } catch (e) {
      return fail(400, "empty", (e as Error).message)
    }
    const here = await existingValues(c, b.envId, b.folderId)
    const have = await listItems(c)
    return Response.json({
      rows: planImport(imported.pairs, here),
      errors: imported.errors,
      entries: imported.entries.map((e) => ({ ...e, status: have.some((i) => i.kind === e.kind && i.name === e.name) ? "exists" : "new" })),
    })
  }
  // Items are project-wide: a temporary grant on one environment doesn't reach them.
  if (b.entries.length && c.role === "viewer") return fail(403, "forbidden", "Your role in this project can't add items.")
  const r = b.items.length
    ? await applyOps(c, b.envId, b.folderId, b.items, [], "merge", { via: "import" })
    : { created: [] as string[], updated: [] as string[], deleted: [] as string[], env: "", request: undefined }
  if (b.items.length && !r.request)
    await audit("secrets_import", {
      detail: `${r.env}: ${r.created.length} new, ${r.updated.length} changed (${names([...r.created, ...r.updated])})`,
      env: r.env,
    })
  // Items need the Developer role (the route's own bar), and each one stands alone: one bad entry doesn't stop the rest.
  const made = { created: [] as string[], updated: [] as string[], failed: [] as string[] }
  if (b.entries.length) {
    const have = await listItems(c)
    for (const e of b.entries) {
      try {
        const hit = have.find((i) => i.kind === e.kind && i.name === e.name)
        if (hit && e.overwrite) {
          await updateItem(c, hit.id, { data: e.data })
          made.updated.push(e.name)
        } else if (!hit) {
          await createItem(c, { kind: e.kind, name: e.name, data: e.data })
          made.created.push(e.name)
        }
      } catch {
        made.failed.push(e.name)
      }
    }
    await audit("secrets_import", { detail: `items: ${made.created.length} new, ${made.updated.length} changed${made.failed.length ? `, ${made.failed.length} failed` : ""}` })
  }
  return Response.json({ ...r, entries: made })
}, { grant: true })
