import { done, json } from "@/lib/api"
import { TypeBody } from "@/lib/doc-schemas"
import * as svc from "@/lib/services/documents"

// Preset types and mine.
export const GET = () => svc.withDocs(async (me) => Response.json({ types: await svc.listTypes(me) }))

export const POST = (req: Request) =>
  svc.withDocs(async (me) => {
    const b = await json(req, TypeBody)
    if (b instanceof Response) return b
    return done(await svc.saveType(me, b))
  })
