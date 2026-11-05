import { z } from "zod"

import { json, uuid, withMember } from "@/lib/api"
import * as svc from "@/lib/services/search"

const Body = z.object({
  versionId: uuid,
  body: z.string().max(5_000_000),
  source: z.enum(["text", "pdf", "docx", "sheet", "pptx", "ocr"]),
})

// Search text the app read from a file's current version (what the web does
// after an upload). Needs edit access; a stale versionId is ignored.
export const PUT = (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) =>
  withMember(async (me) => {
    const b = await json(req, Body)
    if (b instanceof Response) return b
    await svc.saveContent(me, (await params).id, b.versionId, b.body, b.source)
    return Response.json({})
  })
