import { notFound } from "next/navigation"

import { AlbumDetail } from "@/components/album-detail"
import { getAlbum } from "@/lib/services/albums"
import { requireMember } from "@/lib/session"

export const metadata = { title: "Album · Nimbus" }

export default async function AlbumPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await getAlbum(await requireMember(), id)
  if (!data) notFound()
  return <AlbumDetail data={data} />
}
