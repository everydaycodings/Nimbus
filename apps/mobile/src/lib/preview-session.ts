import type { Item, Role, Version } from "@nimbus/shared/api"
import { router } from "expo-router"

// Router params can't carry hundreds of items, so the list opens the previewer through here.
export type PreviewSession = {
  items: Item[]
  index: number
  role: Role
  // An older version opens alone, with no swiping.
  version?: Version
  // The list's next page, for swiping past what's loaded.
  more?: () => Promise<Item[] | null>
}

let current: PreviewSession | null = null

export const previewSession = () => current

export function openPreview(session: PreviewSession) {
  current = session
  router.push("/preview")
}
