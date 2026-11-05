import { z } from "zod"

import { query, uuid, withMember } from "@/lib/api"
import * as svc from "@/lib/services/files"

// The move dialog's folder picker: subfolders of ?parent= (omit for My files).
// Inside someone else's folder, its owner's subfolders.
export const GET = (req: Request) =>
  withMember(async (me) => {
    const q = query(req, z.object({ parent: uuid.optional() }))
    if (q instanceof Response) return q
    return Response.json({ folders: await svc.listFolders(me, q.parent ?? null) })
  })
