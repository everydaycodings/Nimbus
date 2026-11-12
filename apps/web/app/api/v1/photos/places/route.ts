import { z } from "zod"

import { query, withMember } from "@/lib/api"
import { parseBbox, placeItems, places } from "@/lib/services/photos"

const q = z.object({
  bbox: z.string().max(100).optional(),
  items: z.enum(["0", "1"]).default("0"),
})

// My own photos with a location (nobody else's, ever). `items=1`: the photos inside `bbox` instead.
export const GET = (req: Request) =>
  withMember(async (me) => {
    const p = query(req, q)
    if (p instanceof Response) return p
    const box = parseBbox(p.bbox)
    return Response.json(
      p.items === "1" ? await placeItems(me, box) : { points: await places(me, box) }
    )
  })
