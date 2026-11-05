import { z } from "zod"

import { done, json, listResponse, notFound, withMember } from "@/lib/api"
import { TAG_COLORS } from "@/lib/db/schema"
import { listByTag, listTags } from "@/lib/files"
import * as svc from "@/lib/services/files"

type Ctx = { params: Promise<{ id: string }> }

// The tag, how many items carry it, and those items the member can see.
export const GET = (req: Request, { params }: Ctx) =>
  withMember(async (me) => {
    const { id } = await params
    const tag = (await listTags(me.id)).find((t) => t.id === id)
    if (!tag) return notFound("That tag")
    return listResponse(me, req, await listByTag(me.id, id), {}, {
      tag,
      count: await svc.tagCount(me, id),
    })
  })

const Patch = z.object({
  name: z.string().optional(),
  color: z.enum(TAG_COLORS).optional(),
})

// Rename and/or recolor. A name another of your tags already has answers 200
// with { merge: <that tag's id> }; call POST /tags/{id}/merge to combine them.
export const PATCH = (req: Request, { params }: Ctx) =>
  withMember(async (me) => {
    const b = await json(req, Patch)
    if (b instanceof Response) return b
    const { id } = await params
    if (b.color) {
      const r = await svc.recolorTag(me, id, b.color)
      if (r.error) return done(r)
    }
    return done(b.name !== undefined ? await svc.renameTag(me, id, b.name) : {})
  })

// Returns what POST /tags/restore needs to undo it.
export const DELETE = (_: Request, { params }: Ctx) =>
  withMember(async (me) => {
    const snap = await svc.deleteTag(me, (await params).id)
    return snap ? Response.json(snap) : notFound("That tag")
  })
