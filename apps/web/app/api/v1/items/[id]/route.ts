import { z } from "zod"

import { done, json, notFound, withMember } from "@/lib/api"
import { getItem } from "@/lib/files"
import * as svc from "@/lib/services/files"

type Ctx = { params: Promise<{ id: string }> }

// One item as it shows in a list, plus the details panel.
export const GET = (_: Request, { params }: Ctx) =>
  withMember(async (me) => {
    const { id } = await params
    const details = await svc.getDetails(me, id)
    if (!details) return notFound()
    return Response.json({ item: await getItem(me.id, id), details })
  })

// Rename.
export const PATCH = (req: Request, { params }: Ctx) =>
  withMember(async (me) => {
    const b = await json(req, z.object({ name: z.string() }))
    if (b instanceof Response) return b
    return done(await svc.renameItem(me, (await params).id, b.name))
  })
