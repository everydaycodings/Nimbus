import { notFound, uuid, withMember } from "@/lib/api"
import { folderTree } from "@/lib/services/sync"

// Everything under a folder with hashes and modified times: folder sync and "Save to device".
// `?folder=` omitted: My files.
export const GET = (req: Request) =>
  withMember(async (me) => {
    const raw = new URL(req.url).searchParams.get("folder")
    const folder = raw === null ? null : uuid.safeParse(raw)
    if (folder && !folder.success) return notFound("That folder")
    const tree = await folderTree(me, folder ? folder.data : null)
    return tree ? Response.json(tree) : notFound("That folder")
  })
