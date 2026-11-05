import { listResponse, withMember } from "@/lib/api"
import { getTrashRetention, listTrash } from "@/lib/files"

// Newest trashed first. `retentionDays` null: items stay until deleted.
export const GET = (req: Request) =>
  withMember(async (me) =>
    listResponse(me, req, await listTrash(me.id), { sort: "date", trash: true }, {
      retentionDays: await getTrashRetention(),
    })
  )
