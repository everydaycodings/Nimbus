import { z } from "zod"

import { done, json, withMember } from "@/lib/api"
import { createLink } from "@/lib/services/albums"

const body = z.object({ name: z.string().optional(), password: z.string().optional() })

// A public view-only link at <server>/a/<token>.
export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  withMember(async (me) => {
    const b = await json(req, body)
    if (b instanceof Response) return b
    return done(await createLink(me, (await params).id, b))
  })
