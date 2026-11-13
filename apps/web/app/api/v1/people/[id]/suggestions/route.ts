import { notFound, withMember } from "@/lib/api"
import { suggestions } from "@/lib/services/people"

// Faces that look like this person but weren't joined ("Is this X?"). PersonSuggestionsResponse.
export const GET = (_: Request, { params }: { params: Promise<{ id: string }> }) =>
  withMember(async (me) => {
    const list = await suggestions(me, (await params).id)
    return list ? Response.json({ suggestions: list }) : notFound("That person")
  })
