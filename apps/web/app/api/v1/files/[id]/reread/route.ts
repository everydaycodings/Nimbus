import { fail, withMember } from "@/lib/api"
import * as svc from "@/lib/services/search"

// Owner only: the worker reads this file's text again.
export const POST = (
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) =>
  withMember(async (me) =>
    (await svc.reread(me, (await params).id))
      ? new Response(null, { status: 204 })
      : fail(403, "forbidden", "Only the owner can have the text read again.")
  )
