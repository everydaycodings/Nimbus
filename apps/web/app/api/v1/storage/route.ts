import { z } from "zod"

import { query, uuid, withMember } from "@/lib/api"
import { report } from "@/lib/storage-report"

// What fills my storage: usage, big files, older versions, trash, and each
// folder's size. ?folder= drills into one of my folders.
export const GET = (req: Request) =>
  withMember(async (me) => {
    const q = query(req, z.object({ folder: uuid.optional() }))
    if (q instanceof Response) return q
    return Response.json(await report(me.id, q.folder ?? null))
  })
