import { z } from "zod"

import { done, json, withMember } from "@/lib/api"
import { previewRestore } from "@/lib/services/point-restore"

// What restoring this folder ("root": all of My files) to a time would change. Changes nothing.
export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  withMember(async (me) => {
    const b = await json(req, z.object({ at: z.coerce.date() }))
    if (b instanceof Response) return b
    const id = (await params).id
    return done(await previewRestore(me, id === "root" ? null : id, b.at))
  })
