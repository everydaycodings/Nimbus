import { PhotosTimeline } from "@/components/photos-timeline"
import { listPhotos } from "@/lib/files"
import { getPartners } from "@/lib/services/partners"
import { requireMember } from "@/lib/session"
import { getSettings } from "@/lib/signup"

export const metadata = { title: "Photos · Nimbus" }

export default async function PhotosPage() {
  const me = await requireMember()
  const [first, settings, partner] = await Promise.all([
    listPhotos(me.id, 500),
    getSettings(),
    getPartners(me),
  ])
  const partners = partner.incoming.filter((p) => p.status === "active")
  return <PhotosTimeline first={first} mapOn={settings.mapEnabled} partners={partners} />
}
