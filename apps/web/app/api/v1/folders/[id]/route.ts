import { notFound, listResponse, withMember } from "@/lib/api"
import { visiblePath } from "@/lib/access"
import { getFolder, listFolder } from "@/lib/files"

type Ctx = { params: Promise<{ id: string }> }

// A folder's contents with the breadcrumb (as far as this member may see) and
// their role in it. In someone else's folder, `role` is editor or viewer.
export const GET = (req: Request, { params }: Ctx) =>
  withMember(async (me) => {
    const { id } = await params
    const folder = await getFolder(me.id, id)
    if (!folder) return notFound("That folder")
    const [items, path] = await Promise.all([
      listFolder(me.id, folder.ownerId, id, folder.role),
      visiblePath(me.id, id),
    ])
    return listResponse(me, req, items, {}, {
      folder: { id, name: folder.name, role: folder.role, ownerId: folder.ownerId, ...(folder.system ? { system: folder.system } : {}) },
      path,
    })
  })
