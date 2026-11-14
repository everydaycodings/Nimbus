import { z } from "zod"

import { json, query, uuid } from "@/lib/api"
import { audit } from "@/lib/audit"
import { names } from "@/lib/secrets/format"
import { projectRoute } from "@/lib/secrets/guard"
import {
  applyOps,
  envSlugAndFolder,
  exportPairs,
  listSecrets,
} from "@/lib/secrets/service"

// One folder of one environment (`env` is a slug, `folder` a path like "app/api").
// Without `expand` or `values`: rows with no values, for the table. With them:
// { secrets: [{ key, value }] }, references expanded when `expand=true`. Logged.
export const GET = projectRoute("viewer", async (c, req) => {
  const q = query(
    req,
    z.object({
      env: z.string(),
      folder: z.string().default(""),
      expand: z.enum(["true", "false"]).optional(),
      values: z.enum(["true", "false"]).optional(),
    })
  )
  if (q instanceof Response) return q
  const at = await envSlugAndFolder(c, q.env, q.folder)
  if (q.expand === undefined && q.values !== "true")
    return Response.json({ secrets: await listSecrets(c, at.envId, at.folderId) })
  const pairs = await exportPairs(c, at, { expand: q.expand === "true", own: true })
  await audit("secrets_read", { detail: `${q.env}${q.folder ? `/${q.folder}` : ""}: ${pairs.length} secrets` })
  return Response.json({ secrets: pairs })
})

const op = z.object({
  id: uuid.optional(),
  key: z.string().max(200),
  value: z.string().max(100_000).optional(),
  comment: z.string().max(1000).nullable().optional(),
  type: z.string().max(10).nullable().optional(),
  rotationAt: z.string().max(40).nullable().optional(),
  tags: z.array(z.string().max(32)).max(20).optional(),
})

// The table's "Save changes": edits, new rows and deletes in one go, all or nothing.
export const POST = projectRoute("developer", async (c, req) => {
  const b = await json(
    req,
    z.object({
      envId: uuid,
      folderId: uuid.nullable().default(null),
      ops: z.array(op).max(1000).default([]),
      deletes: z.array(uuid).max(1000).default([]),
    })
  )
  if (b instanceof Response) return b
  const r = await applyOps(c, b.envId, b.folderId, b.ops, b.deletes)
  const parts = [
    r.created.length && `added ${names(r.created)}`,
    r.updated.length && `changed ${names(r.updated)}`,
    r.deleted.length && `deleted ${names(r.deleted)}`,
  ].filter(Boolean)
  if (parts.length) await audit("secrets_write", { detail: `${r.env}: ${parts.join("; ")}`, env: r.env })
  return Response.json(r)
}, { grant: true })
