import { done, withMember } from "@/lib/api"
import * as svc from "@/lib/services/uploads"

// Saves this version as its own file next to the original ("report (v3).pdf").
export const POST = (
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) => withMember(async (me) => done(await svc.copyVersion(me, (await params).id)))
