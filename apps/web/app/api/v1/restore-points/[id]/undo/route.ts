import { done, withMember } from "@/lib/api"
import { undoRestore } from "@/lib/services/point-restore"

// Puts back what a restore changed, for 7 days. Returns how many changes went back and how many couldn't.
export const POST = (_: Request, { params }: { params: Promise<{ id: string }> }) =>
  withMember(async (me) => done(await undoRestore(me, (await params).id)))
