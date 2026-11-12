import { z } from "zod"

import { done, json, withMember } from "@/lib/api"
import { getPartners, invite, updatePartner } from "@/lib/services/partners"

const inviteBody = z.object({ userId: z.string(), since: z.string().nullable().optional() })
const patchBody = z.object({
  userId: z.string(),
  since: z.string().nullable().optional(),
  stop: z.boolean().optional(),
  accept: z.boolean().optional(),
  shareBack: z.boolean().optional(),
  decline: z.boolean().optional(),
  hidden: z.boolean().optional(),
})

export const GET = () => withMember(async (me) => Response.json(await getPartners(me)))

// Invite a member to see my photos.
export const POST = (req: Request) =>
  withMember(async (me) => {
    const b = await json(req, inviteBody)
    if (b instanceof Response) return b
    return done(await invite(me, b))
  })

// Change since / stop sharing (mine); accept, decline or hide (theirs).
export const PATCH = (req: Request) =>
  withMember(async (me) => {
    const b = await json(req, patchBody)
    if (b instanceof Response) return b
    return done(await updatePartner(me, b))
  })
