import { z } from "zod"

import { query, withMember } from "@/lib/api"
import { listPhotos } from "@/lib/files"

const photosQuery = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(500),
  cursor: z.string().max(100).optional(),
  // "0": my own only, without my partner's photos.
  partner: z.enum(["0", "1"]).default("1"),
})

// My photos and videos plus my partner's (fromPartner), newest taken first; pass nextCursor back until it is null.
export const GET = (req: Request) =>
  withMember(async (me) => {
    const q = query(req, photosQuery)
    if (q instanceof Response) return q
    return Response.json(await listPhotos(me.id, q.limit, q.cursor, q.partner === "1"))
  })
