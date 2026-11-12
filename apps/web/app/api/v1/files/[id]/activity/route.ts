import { z } from "zod"

import { notFound, query, withMember } from "@/lib/api"
import { listActivity } from "@/lib/activity"
import { ACTIVITY_LIMIT } from "@/lib/activity-rules"

const page = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(ACTIVITY_LIMIT).default(ACTIVITY_LIMIT),
})

// Who changed this file, or everything inside this folder, newest first. ?offset= and ?limit= page
// it (50 at most); total counts every event.
export const GET = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  withMember(async (me) => {
    const q = query(req, page)
    if (q instanceof Response) return q
    const r = await listActivity(me.id, (await params).id, q)
    return r ? Response.json(r) : notFound()
  })
