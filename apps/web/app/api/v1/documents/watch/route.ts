import { z } from "zod"

import { done, json, uuid } from "@/lib/api"
import * as svc from "@/lib/services/documents"

// Folders whose files all count as documents (folders), and folders whose files never do (ignored).
const both = async (me: Parameters<typeof svc.listWatch>[0]) => {
  const [folders, ignored] = await Promise.all([svc.listWatch(me), svc.listWatch(me, true)])
  return Response.json({ folders, ignored })
}

export const GET = () => svc.withDocs(both)

export const POST = (req: Request) =>
  svc.withDocs(async (me) => {
    const b = await json(req, z.object({ folderId: uuid, ignore: z.boolean().optional() }))
    if (b instanceof Response) return b
    const r = await svc.addWatch(me, b.folderId, b.ignore ?? false)
    return r.error ? done(r) : both(me)
  })
