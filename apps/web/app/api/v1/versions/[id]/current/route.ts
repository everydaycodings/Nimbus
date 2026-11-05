import { done, withMember } from "@/lib/api"
import * as svc from "@/lib/services/uploads"

// Points the file at this version; switching back is the same call.
export const POST = (
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) => withMember(async (me) => done(await svc.makeCurrent(me, (await params).id)))
