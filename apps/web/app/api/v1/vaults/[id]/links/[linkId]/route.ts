import { done, withMember } from "@/lib/api"
import * as svc from "@/lib/services/vault"

// Revoke: the link stops working and its wrapped keys are gone.
export const DELETE = (
  _: Request,
  { params }: { params: Promise<{ id: string; linkId: string }> }
) =>
  withMember(async (me) => {
    const { id, linkId } = await params
    return done(await svc.revokeVaultLink(me, id, linkId))
  })
