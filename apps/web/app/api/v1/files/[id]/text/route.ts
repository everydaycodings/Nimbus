import { notFound, withMember } from "@/lib/api"
import * as svc from "@/lib/services/search"

// ?q=words: every place they match in this file, { parts } in document order
// (the previewer's search box). No q: what the worker read, { state, preview, ... }
// for Details → Text found.
export const GET = (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) =>
  withMember(async (me) => {
    const { id } = await params
    const q = new URL(req.url).searchParams.get("q") ?? ""
    if (q.trim()) {
      const parts = await svc.fileText(me, id, q)
      return parts ? Response.json({ parts }) : notFound("That file")
    }
    const status = await svc.fileTextStatus(me, id)
    return status ? Response.json(status) : notFound("That file")
  })
