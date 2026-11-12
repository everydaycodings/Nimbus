import { z } from "zod"

import { json, notFound, withMember } from "@/lib/api"
import * as pos from "@/lib/playback-positions"

type Ctx = { params: Promise<{ id: string }> }

// Where I left off, or { position: null }. Only media over 10 minutes keeps one.
export const GET = (_: Request, { params }: Ctx) =>
  withMember(async (me) => {
    const r = await pos.getPosition(me, (await params).id)
    return r === undefined ? notFound("That file") : Response.json({ position: r })
  })

const body = z.object({
  position: z.number().min(0),
  duration: z.number().positive(),
})

// Saves my position (seconds). Stored only for media over 10 minutes; near the
// start or the end it clears instead. Answers { stored }.
export const PUT = (req: Request, { params }: Ctx) =>
  withMember(async (me) => {
    const b = await json(req, body)
    if (b instanceof Response) return b
    const stored = await pos.savePosition(me, (await params).id, b.position, b.duration)
    return stored === undefined ? notFound("That file") : Response.json({ stored })
  })

