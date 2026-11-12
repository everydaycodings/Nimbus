import { z } from "zod"

import { done, json, withMember } from "@/lib/api"
import { applyRestore } from "@/lib/services/point-restore"

// Restores this folder ("root": all of My files) to a time. The changes are worked out again here;
// `id` of the result undoes them (POST /restore-points/{id}/undo).
export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  withMember(async (me) => {
    const b = await json(req, z.object({ at: z.coerce.date() }))
    if (b instanceof Response) return b
    const id = (await params).id
    return done(await applyRestore(me, id === "root" ? null : id, b.at))
  })
