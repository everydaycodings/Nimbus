import { z } from "zod"

import { done, json, withMember } from "@/lib/api"
import * as svc from "@/lib/services/uploads"

type Ctx = { params: Promise<{ id: string }> }

const Patch = z.object({ note: z.string().optional(), keep: z.boolean().optional() })

// Sets the note ("" clears it) and/or the keep-forever flag.
export const PATCH = (req: Request, { params }: Ctx) =>
  withMember(async (me) => {
    const b = await json(req, Patch)
    if (b instanceof Response) return b
    const { id } = await params
    if (b.note !== undefined) {
      const r = await svc.setVersionNote(me, id, b.note)
      if (r.error) return done(r)
    }
    return done(b.keep !== undefined ? await svc.setVersionKeep(me, id, b.keep) : {})
  })

// Not the current version.
export const DELETE = (_: Request, { params }: Ctx) =>
  withMember(async (me) => done(await svc.deleteVersion(me, (await params).id)))
