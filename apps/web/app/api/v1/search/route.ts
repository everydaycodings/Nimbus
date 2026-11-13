import { listResponse, withMember } from "@/lib/api"
import * as svc from "@/lib/services/search"
import { browseItems, searchItems } from "@/lib/files"

const FILTERS = ["type", "modified", "size", "tag"]

// ?q= searches names and file text, my files and shared. ?quick=1 is the
// search box's dropdown (12 hits, no filters needed). Otherwise it's the full
// results page: up to 50 hits, relevance first, with the list filters. A filter
// ?found=name,text,comments limits where it looks. A filter
// with no text lists everything that matches it, newest first ("all my PDFs").
export const GET = (req: Request) =>
  withMember(async (me) => {
    const sp = new URL(req.url).searchParams
    const q = sp.get("q") ?? ""
    if (sp.get("quick") === "1")
      return Response.json({ items: await svc.quickSearch(me, q) })
    const browsing = !q.trim() && FILTERS.some((f) => sp.get(f))
    return listResponse(
      me,
      req,
      browsing
        ? await browseItems(me.id)
        : await searchItems(me.id, q, 50, {
            found: (sp.get("found") ?? "")
              .split(",")
              .filter((f) => ["name", "text", "comments"].includes(f)),
          }),
      { sort: "rank" }
    )
  })
