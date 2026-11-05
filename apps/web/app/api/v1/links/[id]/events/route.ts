import { z } from "zod"

import { query, withMember } from "@/lib/api"
import * as svc from "@/lib/services/shares"

// The link's access log, newest first. ?limit= up to 500 (default 20).
export const GET = (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) =>
  withMember(async (me) => {
    const q = query(req, z.object({ limit: z.coerce.number().int().min(1).max(500).default(20) }))
    if (q instanceof Response) return q
    return Response.json({
      events: await svc.listLinkEvents(me, (await params).id, q.limit),
    })
  })
