import type { Item, Role, Version } from "@nimbus/shared/api"
import { router } from "expo-router"

// Where in the first file to open: a search found its words there.
export type PlaceStart = { page?: number; tMs?: number; box?: [number, number, number, number] }

// Router params can't carry hundreds of items, so the list opens the previewer through here.
export type PreviewSession = {
  items: Item[]
  index: number
  role: Role
  // An older version opens alone, with no swiping.
  version?: Version
  // The list's next page, for swiping past what's loaded.
  more?: () => Promise<Item[] | null>
  // Set when the files are in this vault: they open from decrypted copies and nothing asks the server about them.
  vault?: string
  start?: PlaceStart
}

let current: PreviewSession | null = null

export const previewSession = () => current

export const clearPreview = () => void (current = null)

export function openPreview(session: PreviewSession) {
  current = session
  router.push("/preview")
}
