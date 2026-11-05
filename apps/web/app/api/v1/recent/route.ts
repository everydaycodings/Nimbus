import { listResponse, withMember } from "@/lib/api"
import { listRecent } from "@/lib/files"

// Last opened first (sort=rank keeps that order; at most 50).
export const GET = (req: Request) =>
  withMember(async (me) =>
    listResponse(me, req, await listRecent(me.id), { sort: "rank" })
  )
