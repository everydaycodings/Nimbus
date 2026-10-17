import { FileBrowser } from "@/components/file-browser"
import { listStarred, pageUserId, viewPrefs, listTags } from "@/lib/files"

export const metadata = { title: "Starred · Nimbus" }

export default async function StarredPage() {
  const me = await pageUserId()
  const [items, prefs, tags] = await Promise.all([
    listStarred(me),
    viewPrefs(),
    listTags(me),
  ])

  return (
    <FileBrowser
      view="starred"
      title="Starred"
      items={items}
      empty={{
        title: "Nothing starred",
        body: "Star the files and folders you come back to and they'll wait here. Select one and press S.",
      }}
      tags={tags}
      {...prefs}
    />
  )
}
