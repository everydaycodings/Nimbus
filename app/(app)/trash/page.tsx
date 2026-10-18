import { FileBrowser } from "@/components/file-browser"
import {
  getTrashRetention,
  listTrash,
  pageUserId,
  viewPrefs,
  listTags,
} from "@/lib/files"

export const metadata = { title: "Trash · Nimbus" }

export default async function TrashPage() {
  const me = await pageUserId()
  const [items, days, prefs, tags] = await Promise.all([
    listTrash(me),
    getTrashRetention(),
    viewPrefs(),
    listTags(me),
  ])
  const keep = days
    ? `Items are deleted forever after ${days} days in the trash.`
    : "Items stay here until you delete them."

  return (
    <FileBrowser
      view="trash"
      title="Trash"
      description={keep}
      items={items}
      empty={{
        title: "Trash is empty",
        body: `Things you delete land here first, so you can restore them. ${keep}`,
      }}
      tags={tags}
      {...prefs}
    />
  )
}
