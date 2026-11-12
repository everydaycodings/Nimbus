"use server"

import { limitIp } from "@/lib/api"
import { albumNode, findAlbumLink, openAlbumLink, unlockAlbum } from "@/lib/album-links"
import { presignGet } from "@/lib/s3"

// Anyone with the link can call these, so each one checks the link itself.

export async function unlockAlbumLink(
  token: string,
  password: string
): Promise<{ error?: string }> {
  const link = await findAlbumLink(String(token))
  if (!link) return { error: "This link doesn't work any more." }
  return unlockAlbum(link, String(password ?? ""))
}

// The shared Previewer passes album tokens as "a:<token>" (see s/actions linkPreviewUrl).
export async function albumPreviewUrl(token: string, id: string) {
  if (await limitIp("album")) return null
  const link = await openAlbumLink(String(token))
  if (!link) return null
  const node = await albumNode(link, String(id))
  if (!node?.key) return null
  const pdf = node.mime === "application/pdf"
  return presignGet(node.key, node.name, {
    inline: pdf,
    type: pdf ? "application/pdf" : undefined,
  })
}
