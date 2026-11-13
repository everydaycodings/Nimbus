import { notFound, withMember } from "@/lib/api"
import { personCover } from "@/lib/services/people"

// The person's face as a webp (256 px square).
export const GET = (_: Request, { params }: { params: Promise<{ id: string }> }) =>
  withMember(async (me) => {
    const img = await personCover(me, (await params).id)
    return img
      ? new Response(img as BodyInit, { headers: { "Content-Type": "image/webp", "Cache-Control": "private, max-age=3600" } })
      : notFound("That face")
  })
