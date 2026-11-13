import type { Item } from "@nimbus/shared/api"
import { useState } from "react"

import { FileSheets } from "@/components/file-sheets"
import type { FileSheet } from "@/lib/files"

const none = () => {}

// The ⋯ sheet for one photo in a photo screen (Photos, a group, a person, an album): the same actions as Files.
export function usePhotoSheet(role: "owner" | "editor" | "viewer" = "owner") {
  const [sheet, setSheet] = useState<FileSheet | null>(null)
  const element = (
    <FileSheets
      sheet={sheet}
      onChange={setSheet}
      role={role}
      trash={false}
      tags={[]}
      filters={{}}
      onFilters={none}
      tagFilter={false}
      sortable={false}
      onOpen={none}
      onDone={() => setSheet(null)}
    />
  )
  return { element, show: (item: Item) => setSheet({ kind: "actions", items: [item] }) }
}
