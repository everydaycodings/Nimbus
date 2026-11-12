import { notFound, withMember } from "@/lib/api"
import { eventStream } from "@/lib/events"
import * as svc from "@/lib/services/comments"

export const dynamic = "force-dynamic"

// Server-Sent Events: `comment` whenever anything in this file's threads changes; refetch then.
export const GET = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  withMember(async (me) => {
    const id = (await params).id
    if (!(await svc.canSeeComments(me, id))) return notFound()
    return eventStream(req, svc.commentChannel(id), "comment")
  })
