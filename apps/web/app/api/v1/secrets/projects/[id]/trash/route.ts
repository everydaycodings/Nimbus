import { z } from "zod"

import { json, uuid } from "@/lib/api"
import { audit } from "@/lib/audit"
import { names } from "@/lib/secrets/format"
import { projectRoute } from "@/lib/secrets/guard"
import { listTrash, purgeIds, restoreIds } from "@/lib/secrets/service"

export const GET = projectRoute("viewer", async (c) =>
  Response.json({ items: await listTrash(c) })
)

export const POST = projectRoute("developer", async (c, req) => {
  const b = await json(
    req,
    z.object({ action: z.enum(["restore", "purge"]), ids: z.array(uuid).min(1).max(1000) })
  )
  if (b instanceof Response) return b
  if (b.action === "restore") {
    const r = await restoreIds(c, b.ids)
    if (r.restored.length) await audit("secrets_write", { detail: `restored ${names(r.restored)}` })
    return Response.json(r)
  }
  const keys = await purgeIds(c, b.ids)
  await audit("secrets_write", { detail: `permanently deleted ${names(keys)}` })
  return Response.json({ count: keys.length })
})
