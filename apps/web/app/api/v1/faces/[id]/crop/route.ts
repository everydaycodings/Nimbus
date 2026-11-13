import { notFound, withMember } from "@/lib/api"
import { faceCrop } from "@/lib/services/people"

// One face as a webp (256 px square). Only on my own photos.
export const GET = (_: Request, { params }: { params: Promise<{ id: string }> }) =>
  withMember(async (me) => {
    const img = await faceCrop(me, (await params).id)
    return img
      ? new Response(img as BodyInit, { headers: { "Content-Type": "image/webp", "Cache-Control": "private, max-age=3600" } })
      : notFound("That face")
  })
