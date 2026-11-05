import { notFound, withMember } from "@/lib/api"
import * as svc from "@/lib/services/uploads"

// A short-lived direct storage URL for viewing the file. ?v= picks an older
// version (owners and editors); ?open=1 counts as opening it (Recent).
export const GET = (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) =>
  withMember(async (me) => {
    const sp = new URL(req.url).searchParams
    const url = await svc.previewUrl(
      me,
      (await params).id,
      sp.get("v"),
      sp.get("open") === "1"
    )
    return url ? Response.json({ url }) : notFound("That file")
  })
