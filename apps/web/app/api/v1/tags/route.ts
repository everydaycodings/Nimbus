import { z } from "zod"

import { done, json, uuid, withMember } from "@/lib/api"
import { TAG_COLORS } from "@/lib/db/schema"
import { listTags } from "@/lib/files"
import * as svc from "@/lib/services/files"

export const GET = () =>
  withMember(async (me) => Response.json({ tags: await listTags(me.id) }))

// Makes a tag and, optionally, puts it on `applyTo` in one go.
export const POST = (req: Request) =>
  withMember(async (me) => {
    const b = await json(
      req,
      z.object({
        name: z.string(),
        color: z.enum(TAG_COLORS),
        applyTo: z.array(uuid).max(1000).default([]),
      })
    )
    if (b instanceof Response) return b
    const r = await svc.createTag(me, b.name, b.color, b.applyTo)
    if (r.error) return done(r)
    const tag = (await listTags(me.id)).find(
      (t) => t.name.toLowerCase() === b.name.trim().toLowerCase()
    )
    return Response.json({ tag })
  })
