import { notFound } from "next/navigation"

import { PhotosTimeline } from "@/components/photos-timeline"
import { smart } from "@/lib/services/photos"
import { requireMember } from "@/lib/session"
import { getSettings } from "@/lib/signup"
import { isSmartGroup } from "@nimbus/shared/smart-groups"

export const metadata = { title: "Photos · Nimbus" }

export default async function SmartPage({ params }: { params: Promise<{ group: string }> }) {
  const { group } = await params
  if (!isSmartGroup(group)) notFound()
  const me = await requireMember()
  const [first, settings] = await Promise.all([smart(me, group, 500), getSettings()])
  if (!first) notFound()
  return <PhotosTimeline first={first} group={group} mapOn={settings.mapEnabled} />
}
