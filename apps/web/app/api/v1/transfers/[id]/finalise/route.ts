import { done, withMember } from "@/lib/api"
import * as svc from "@/lib/services/transfers"

// Opens the draft and emails its recipients. Safe to call twice.
export const POST = (
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) => withMember(async (me) => done(await svc.finaliseTransfer(me, (await params).id)))
