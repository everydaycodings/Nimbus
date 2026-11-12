import { z } from "zod"

import { query, withMember } from "@/lib/api"
import { memories } from "@/lib/services/photos"

const q = z.object({ date: z.string().regex(/^\d{4}-\d\d-\d\d$/).optional() })

// On this day: pass the phone's local date; this month and day in past years, grouped by year.
export const GET = (req: Request) =>
  withMember(async (me) => {
    const p = query(req, q)
    if (p instanceof Response) return p
    return Response.json(await memories(me, p.date))
  })
