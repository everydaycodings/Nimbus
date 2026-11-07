import { notFound, withMember } from "@/lib/api"
import * as svc from "@/lib/services/transfers"

// One transfer with its access log (newest 100 events).
export const GET = (
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) =>
  withMember(async (me) => {
    const r = await svc.getTransfer(me, (await params).id)
    return r ? Response.json(r) : notFound("That transfer")
  })
