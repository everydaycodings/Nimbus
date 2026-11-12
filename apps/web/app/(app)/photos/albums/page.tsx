import { AlbumsGrid } from "@/components/albums-grid"
import { listAlbums } from "@/lib/services/albums"
import { requireMember } from "@/lib/session"
import { getSettings } from "@/lib/signup"

export const metadata = { title: "Albums · Nimbus" }

export default async function AlbumsPage() {
  const me = await requireMember()
  const [albums, settings] = await Promise.all([listAlbums(me), getSettings()])
  return <AlbumsGrid albums={albums} mapOn={settings.mapEnabled} />
}
