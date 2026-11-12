import { notFound } from "next/navigation"

import { PlacesMap } from "@/components/places-map"
import { requireMember } from "@/lib/session"
import { getSettings } from "@/lib/signup"

export const metadata = { title: "Places · Nimbus" }

export default async function PlacesPage() {
  await requireMember()
  const settings = await getSettings()
  if (!settings.mapEnabled) notFound()
  return <PlacesMap styleUrl={settings.mapStyleUrl} />
}
