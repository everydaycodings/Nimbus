import { notFound } from "next/navigation"

import { PhotosTimeline } from "@/components/photos-timeline"
import { aiFlags } from "@/lib/ai"
import { personPhotos } from "@/lib/services/people"
import { requireMember } from "@/lib/session"
import { getSettings } from "@/lib/signup"

export const metadata = { title: "People · Nimbus" }

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireMember()
  if (!(await aiFlags(me.id)).facesOn) notFound()
  const [first, settings] = await Promise.all([personPhotos(me, (await params).id, 500), getSettings()])
  if (!first) notFound()
  // A new key starts the grid over when a review or move changes what's in it.
  return (
    <PhotosTimeline
      key={`${first.total}:${first.items[0]?.id ?? ""}:${first.person.suggestions}`}
      first={first}
      person={first.person}
      mapOn={settings.mapEnabled}
    />
  )
}
