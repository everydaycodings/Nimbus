import { z } from "zod"

import { done, fail, json, withMember } from "@/lib/api"
import * as svc from "@/lib/services/account"

// Pick a preset (its path from GET /account/avatars) or "provider".
export const PUT = (req: Request) =>
  withMember(async (me) => {
    const b = await json(req, z.object({ choice: z.string() }))
    if (b instanceof Response) return b
    return (await svc.pickAvatar(me, b.choice))
      ? Response.json({})
      : fail(400, "refused", "That picture isn't available.")
  })

// multipart/form-data with `file`: a 256px JPEG of at most 300 KB, already cropped.
export const POST = (req: Request) =>
  withMember(async (me) => {
    const form = await req.formData().catch(() => null)
    if (!form) return fail(400, "bad-request", "Send the picture as form data.")
    return done((await svc.uploadAvatar(me, form.get("file"))) ?? {})
  })
