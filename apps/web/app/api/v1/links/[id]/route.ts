import { z } from "zod"

import { done, json, withMember } from "@/lib/api"
import * as svc from "@/lib/services/shares"

type Ctx = { params: Promise<{ id: string }> }

const Patch = z.object({
  name: z.string().optional(),
  // ISO date; null removes the expiry (refused when the server caps links).
  expiresAt: z.string().nullable().optional(),
  // "" removes the password.
  password: z.string().optional(),
  allowView: z.boolean().optional(),
  allowDownload: z.boolean().optional(),
  allowUpload: z.boolean().optional(),
  uploadCapBytes: z.number().positive().nullable().optional(),
})

export const PATCH = (req: Request, { params }: Ctx) =>
  withMember(async (me) => {
    const b = await json(req, Patch)
    if (b instanceof Response) return b
    return done(await svc.updateLink(me, (await params).id, b))
  })

export const DELETE = (_: Request, { params }: Ctx) =>
  withMember(async (me) => done(await svc.deleteLink(me, (await params).id)))
