import { z } from "zod"

import { notFound, query, withMember } from "@/lib/api"
import { smart } from "@/lib/services/photos"

const q = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(500),
  cursor: z.string().max(100).optional(),
})

// screenshots, documents, receipts or videos: my photos in that group, like GET /photos.
export const GET = (req: Request, { params }: { params: Promise<{ group: string }> }) =>
  withMember(async (me) => {
    const p = query(req, q)
    if (p instanceof Response) return p
    const r = await smart(me, (await params).group, p.limit, p.cursor)
    return r ? Response.json(r) : notFound("That group")
  })
