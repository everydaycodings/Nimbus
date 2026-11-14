import { z } from "zod"

import { done, json, uuid } from "@/lib/api"
import * as svc from "@/lib/services/documents"

// Folders whose files all count as documents.
export const GET = () => svc.withDocs(async (me) => Response.json({ folders: await svc.listWatch(me) }))

export const POST = (req: Request) =>
  svc.withDocs(async (me) => {
    const b = await json(req, z.object({ folderId: uuid }))
    if (b instanceof Response) return b
    const r = await svc.addWatch(me, b.folderId)
    return r.error ? done(r) : Response.json({ folders: await svc.listWatch(me) })
  })
