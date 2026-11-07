import { notFound, withMember } from "@/lib/api"
import { listActivity } from "@/lib/activity"

// Who changed this file, or everything inside this folder, newest first (50 at most).
export const GET = (_: Request, { params }: { params: Promise<{ id: string }> }) =>
  withMember(async (me) => {
    const events = await listActivity(me.id, (await params).id)
    return events ? Response.json({ events }) : notFound()
  })
