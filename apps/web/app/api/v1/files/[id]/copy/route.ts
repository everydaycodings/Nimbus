import { done, withMember } from "@/lib/api"
import { requestCopy } from "@/lib/video-copies"

// "Make data-saver copy" (owner only): queues the 720p and 480p copies. Answers
// { status: "pending" | "done" }; 400 when an admin has copies off or the size limit is reached.
export const POST = (
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) => withMember(async (me) => done(await requestCopy(me, (await params).id)))
