import { z } from "zod"

import { done, json, withMember } from "@/lib/api"
import { removeShare, updateShare } from "@/lib/services/albums"

type Ctx = { params: Promise<{ id: string; shareId: string }> }

const patch = z.object({
  role: z.enum(["viewer", "contributor"]).optional(),
  name: z.string().optional(),
  expiresAt: z.string().nullable().optional(),
  password: z.string().optional(),
  allowDownload: z.boolean().optional(),
})

// A person's role, or a link's name, expiry, password ("" removes it) and downloads.
export const PATCH = (req: Request, { params }: Ctx) =>
  withMember(async (me) => {
    const b = await json(req, patch)
    if (b instanceof Response) return b
    const { id, shareId } = await params
    return done(await updateShare(me, id, shareId, b))
  })

export const DELETE = (_: Request, { params }: Ctx) =>
  withMember(async (me) => {
    const { id, shareId } = await params
    return done(await removeShare(me, id, shareId))
  })
