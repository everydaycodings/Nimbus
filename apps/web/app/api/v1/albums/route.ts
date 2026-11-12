import { z } from "zod"

import { done, json, uuid, withMember } from "@/lib/api"
import { createAlbum, listAlbums } from "@/lib/services/albums"

const body = z.object({ name: z.string(), nodeIds: z.array(uuid).max(1000).optional() })

// Mine and the ones shared with me, newest changed first.
export const GET = () =>
  withMember(async (me) => Response.json({ albums: await listAlbums(me) }))

export const POST = (req: Request) =>
  withMember(async (me) => {
    const b = await json(req, body)
    if (b instanceof Response) return b
    return done(await createAlbum(me, b))
  })
