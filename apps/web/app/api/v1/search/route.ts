import { listResponse, withMember } from "@/lib/api"
import * as svc from "@/lib/services/search"
import { searchItems } from "@/lib/files"

// ?q= searches names and file text, my files and shared. ?quick=1 is the
// search box's dropdown (12 hits, no filters needed). Otherwise it's the full
// results page: up to 50 hits, relevance first, with the list filters.
export const GET = (req: Request) =>
  withMember(async (me) => {
    const sp = new URL(req.url).searchParams
    const q = sp.get("q") ?? ""
    if (sp.get("quick") === "1")
      return Response.json({ items: await svc.quickSearch(me, q) })
    return listResponse(me, req, await searchItems(me.id, q), { sort: "rank" })
  })
