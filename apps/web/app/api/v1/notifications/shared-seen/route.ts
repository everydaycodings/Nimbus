import { withMember } from "@/lib/api"
import * as svc from "@/lib/services/notifications"

// Visiting Shared with me clears its badge.
export const POST = () =>
  withMember(async (me) => {
    await svc.markSharedSeen(me)
    return Response.json({})
  })
