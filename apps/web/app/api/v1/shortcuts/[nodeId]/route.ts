import { done, withMember } from "@/lib/api"
import * as svc from "@/lib/services/files"

export const DELETE = (
  _: Request,
  { params }: { params: Promise<{ nodeId: string }> }
) =>
  withMember(async (me) =>
    done(await svc.removeShortcut(me, (await params).nodeId))
  )
