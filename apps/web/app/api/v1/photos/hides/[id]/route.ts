import { done, withMember } from "@/lib/api"
import { removeHide } from "@/lib/services/photos"

// Show it in memories again.
export const DELETE = (_: Request, { params }: { params: Promise<{ id: string }> }) =>
  withMember(async (me) => done(await removeHide(me, (await params).id)))
