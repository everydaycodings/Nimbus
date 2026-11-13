import { notFound, withMember } from "@/lib/api"
import { personFaces } from "@/lib/services/people"

// Their faces, clearest first, to pick a picture from. PersonFacesResponse.
export const GET = (_: Request, { params }: { params: Promise<{ id: string }> }) =>
  withMember(async (me) => {
    const list = await personFaces(me, (await params).id)
    return list ? Response.json({ faces: list }) : notFound("That person")
  })
