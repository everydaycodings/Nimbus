import { done, notFound, uuid } from "@/lib/api"
import * as svc from "@/lib/services/documents"

export const DELETE = (_: Request, { params }: { params: Promise<{ folderId: string }> }) =>
  svc.withDocs(async (me) => {
    const { folderId } = await params
    if (!uuid.safeParse(folderId).success) return notFound("That folder")
    return done(await svc.removeWatch(me, folderId))
  })
