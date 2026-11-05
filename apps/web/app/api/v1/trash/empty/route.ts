import { withMember } from "@/lib/api"
import * as svc from "@/lib/services/files"

// Deletes everything in my trash for good.
export const POST = () =>
  withMember(async (me) => {
    await svc.emptyTrash(me)
    return Response.json({})
  })
