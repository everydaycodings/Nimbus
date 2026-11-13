import { z } from "zod"

import { done, json, withMember } from "@/lib/api"
import { fileFaces, tagPhoto } from "@/lib/services/people"

// Faces on one of my photos (FileFacesResponse), left to right. Empty on photos that aren't mine.
export const GET = (_: Request, { params }: { params: Promise<{ id: string }> }) =>
  withMember(async (me) => Response.json({ faces: await fileFaces(me, (await params).id) }))

// Tag the photo with a person when no face of theirs was found: { personId } or { name }. PersonResult.
const tag = z.object({ personId: z.string().uuid().optional(), name: z.string().max(80).optional() })
export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  withMember(async (me) => {
    const b = await json(req, tag)
    if (b instanceof Response) return b
    return done(await tagPhoto(me, (await params).id, b))
  })
