import { PhotosTimeline } from "@/components/photos-timeline"
import { listPhotos, pageUserId } from "@/lib/files"

export const metadata = { title: "Photos · Nimbus" }

export default async function PhotosPage() {
  const me = await pageUserId()
  const first = await listPhotos(me, 500)
  return <PhotosTimeline first={first} />
}
