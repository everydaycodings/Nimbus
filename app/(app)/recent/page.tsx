import { FileBrowser } from "@/components/file-browser"
import { listRecent, pageUserId, viewPrefs, listTags } from "@/lib/files"

export const metadata = { title: "Recent · Nimbus" }

export default async function RecentPage() {
  const me = await pageUserId()
  const [items, prefs, tags] = await Promise.all([
    listRecent(me),
    viewPrefs(),
    listTags(me),
  ])

  return (
    <FileBrowser
      view="recent"
      title="Recent"
      items={items}
      empty={{
        title: "Nothing recent",
        body: "Files and folders you add, rename or move show up here, newest first.",
      }}
      tags={tags}
      {...prefs}
    />
  )
}
