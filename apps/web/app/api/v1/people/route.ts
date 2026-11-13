import { z } from "zod"

import { query, withMember } from "@/lib/api"
import { listPeople } from "@/lib/services/people"

const q = z.object({ hidden: z.enum(["0", "1"]).default("0") })

// People found in my photos (PeopleResponse): named first, then the most photos.
// ?hidden=1 lists only the ones I hid.
export const GET = (req: Request) =>
  withMember(async (me) => {
    const p = query(req, q)
    if (p instanceof Response) return p
    return Response.json(await listPeople(me, p.hidden === "1"))
  })
