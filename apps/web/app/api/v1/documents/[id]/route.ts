import { done, json, notFound, uuid } from "@/lib/api"
import * as svc from "@/lib/services/documents"
import { Patch } from "@/lib/doc-schemas"

type Ctx = { params: Promise<{ id: string }> }

export const GET = (_: Request, { params }: Ctx) =>
  svc.withDocs(async (me) => {
    const { id } = await params
    const d = uuid.safeParse(id).success ? await svc.getDocument(me, id) : null
    return d ? Response.json(d) : notFound("That document")
  })

// Edit fields, confirm (status "confirmed"), "Not a document" (status "dismissed") or undo (status "review"). Owner only.
export const PATCH = (req: Request, { params }: Ctx) =>
  svc.withDocs(async (me) => {
    const { id } = await params
    if (!uuid.safeParse(id).success) return notFound("That document")
    const b = await json(req, Patch)
    if (b instanceof Response) return b
    return done(await svc.updateDocument(me, id, b))
  })
