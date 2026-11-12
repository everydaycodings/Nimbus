import { withMember } from "@/lib/api"
import { eventStream } from "@/lib/events"

export const dynamic = "force-dynamic"

// Server-Sent Events: `notification` with {id} whenever the bell gets a row for
// this member, and a ping comment every 25 seconds so proxies keep it open.
export const GET = (req: Request) =>
  withMember(async (me) => eventStream(req, me.id, "notification"))
