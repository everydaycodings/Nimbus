import { withMember } from "@/lib/api"
import * as svc from "@/lib/services/account"

export const DELETE = (
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) =>
  withMember(async (me) => {
    await svc.revokeAppPassword(me, (await params).id)
    return Response.json({})
  })
