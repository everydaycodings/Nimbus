import { z } from "zod"

import { done, json, withMember } from "@/lib/api"
import * as svc from "@/lib/services/shares"

type Ctx = { params: Promise<{ id: string }> }

// Changes a person's role (shareId from the share state's `people`).
export const PATCH = (req: Request, { params }: Ctx) =>
  withMember(async (me) => {
    const b = await json(req, z.object({ role: z.enum(["viewer", "editor"]) }))
    if (b instanceof Response) return b
    return done(await svc.setShareRole(me, (await params).id, b.role))
  })

// Removes a person's access (or an invite).
export const DELETE = (_: Request, { params }: Ctx) =>
  withMember(async (me) => done(await svc.removeShare(me, (await params).id)))
