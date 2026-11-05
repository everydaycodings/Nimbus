import { listResponse, withMember } from "@/lib/api"
import { listStarred } from "@/lib/files"

export const GET = (req: Request) =>
  withMember(async (me) => listResponse(me, req, await listStarred(me.id)))
