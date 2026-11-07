import { done, withMember } from "@/lib/api"
import * as svc from "@/lib/services/transfers"

// Turns the links off now; the copies are deleted within the hour.
export const POST = (
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) => withMember(async (me) => done(await svc.revokeTransfer(me, (await params).id)))
