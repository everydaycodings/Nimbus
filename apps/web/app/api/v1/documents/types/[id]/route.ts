import { done, json, notFound, uuid } from "@/lib/api"
import { TypeBody } from "@/lib/doc-schemas"
import * as svc from "@/lib/services/documents"

type Ctx = { params: Promise<{ id: string }> }

// My own types only; presets are fixed. Deleting leaves documents with no type.
export const PATCH = (req: Request, { params }: Ctx) =>
  svc.withDocs(async (me) => {
    const { id } = await params
    if (!uuid.safeParse(id).success) return notFound("That type")
    const b = await json(
      req,
      TypeBody
    )
    if (b instanceof Response) return b
    return done(await svc.saveType(me, b, id))
  })

export const DELETE = (_: Request, { params }: Ctx) =>
  svc.withDocs(async (me) => {
    const { id } = await params
    if (!uuid.safeParse(id).success) return notFound("That type")
    return done(await svc.deleteType(me, id))
  })
