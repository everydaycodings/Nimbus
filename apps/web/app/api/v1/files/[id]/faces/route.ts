import { withMember } from "@/lib/api"
import { fileFaces } from "@/lib/services/people"

// Faces on one of my photos (FileFacesResponse), left to right. Empty on photos that aren't mine.
export const GET = (_: Request, { params }: { params: Promise<{ id: string }> }) =>
  withMember(async (me) => Response.json({ faces: await fileFaces(me, (await params).id) }))
