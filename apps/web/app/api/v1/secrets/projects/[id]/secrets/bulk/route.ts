import { z } from "zod"

import { json, uuid } from "@/lib/api"
import { audit } from "@/lib/audit"
import { names } from "@/lib/secrets/format"
import { projectRoute } from "@/lib/secrets/guard"
import { copyIds, copyKeys, moveIds, tagIdsBulk, trashIds } from "@/lib/secrets/service"

const ids = z.array(uuid).min(1).max(1000)
const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("delete"), ids }),
  z.object({ action: z.literal("move"), ids, folderId: uuid.nullable() }),
  z.object({ action: z.literal("copy"), ids, toEnvId: uuid, overwrite: z.boolean().default(false) }),
  z.object({
    action: z.literal("tag"),
    ids,
    add: z.array(z.string().max(32)).max(20).default([]),
    remove: z.array(z.string().max(32)).max(20).default([]),
  }),
  z.object({
    action: z.literal("copy-keys"),
    fromEnvId: uuid,
    envId: uuid,
    folderId: uuid.nullable().default(null),
    withValues: z.boolean().default(false),
  }),
])

// The table's bulk actions.
export const POST = projectRoute("developer", async (c, req) => {
  const b = await json(req, body)
  if (b instanceof Response) return b
  switch (b.action) {
    case "delete": {
      const keys = await trashIds(c, b.ids)
      await audit("secrets_write", { detail: `deleted ${names(keys)}` })
      return Response.json({ count: keys.length })
    }
    case "move": {
      const keys = await moveIds(c, b.ids, b.folderId)
      await audit("secrets_write", { detail: `moved ${names(keys)}` })
      return Response.json({ count: keys.length })
    }
    case "copy": {
      const r = await copyIds(c, b.ids, b.toEnvId, b.overwrite)
      await audit("secrets_write", { detail: `copied ${r.copied} to another environment` })
      return Response.json(r)
    }
    case "tag": {
      const keys = await tagIdsBulk(c, b.ids, b.add, b.remove)
      return Response.json({ count: keys.length })
    }
    case "copy-keys": {
      const r = await copyKeys(c, b.fromEnvId, b.envId, b.folderId, b.withValues)
      if (r.created.length)
        await audit("secrets_write", { detail: `copied keys ${names(r.created)}` })
      return Response.json({ count: r.created.length })
    }
  }
})
