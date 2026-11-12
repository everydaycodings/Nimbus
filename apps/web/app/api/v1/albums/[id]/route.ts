import { z } from "zod"

import { done, json, notFound, uuid, withMember } from "@/lib/api"
import { deleteAlbum, getAlbum, updateAlbum } from "@/lib/services/albums"

type Ctx = { params: Promise<{ id: string }> }

const patch = z.object({ name: z.string().optional(), coverNodeId: uuid.nullable().optional() })

export const GET = (_: Request, { params }: Ctx) =>
  withMember(async (me) => {
    const r = await getAlbum(me, (await params).id)
    return r ? Response.json(r) : notFound("That album")
  })

// Owner only.
export const PATCH = (req: Request, { params }: Ctx) =>
  withMember(async (me) => {
    const b = await json(req, patch)
    if (b instanceof Response) return b
    return done(await updateAlbum(me, (await params).id, b))
  })

export const DELETE = (_: Request, { params }: Ctx) =>
  withMember(async (me) => done(await deleteAlbum(me, (await params).id)))
