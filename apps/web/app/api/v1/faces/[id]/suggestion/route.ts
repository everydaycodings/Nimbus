import { z } from "zod"

import { done, json, withMember } from "@/lib/api"
import { answerSuggestion } from "@/lib/services/people"

const body = z.object({ accept: z.boolean() })

// "Is this X?": { accept: true } joins the face to X, false means it isn't X. Returns { person } (X).
export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  withMember(async (me) => {
    const b = await json(req, body)
    if (b instanceof Response) return b
    return done(await answerSuggestion(me, (await params).id, b.accept))
  })
