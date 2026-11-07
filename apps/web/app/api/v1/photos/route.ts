import { z } from "zod"

import { query, withMember } from "@/lib/api"
import { listPhotos } from "@/lib/files"

const photosQuery = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(500),
  cursor: z.string().max(100).optional(),
})

// My photos and videos, newest taken first; pass nextCursor back until it is null.
export const GET = (req: Request) =>
  withMember(async (me) => {
    const q = query(req, photosQuery)
    if (q instanceof Response) return q
    return Response.json(await listPhotos(me.id, q.limit, q.cursor))
  })
