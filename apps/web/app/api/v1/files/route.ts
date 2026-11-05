import { listResponse, withMember } from "@/lib/api"
import { listFolder } from "@/lib/files"

// My files, top level: folders first, then files, plus shortcuts.
export const GET = (req: Request) =>
  withMember(async (me) => listResponse(me, req, await listFolder(me.id, me.id, null)))
