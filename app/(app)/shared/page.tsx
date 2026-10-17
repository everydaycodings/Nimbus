import { FileBrowser } from "@/components/file-browser"
import { listShared, pageUserId, viewPrefs, listTags } from "@/lib/files"

export const metadata = { title: "Shared with me · Nimbus" }

export default async function SharedPage() {
  const me = await pageUserId()
  const [items, prefs, tags] = await Promise.all([
    listShared(me),
    viewPrefs(),
    listTags(me),
  ])

  return (
    <FileBrowser
      view="shared"
      title="Shared with me"
      items={items}
      empty={{
        title: "Nothing shared with you yet",
        body: "When someone on this Nimbus shares a file or folder with you, it shows up here.",
      }}
      tags={tags}
      {...prefs}
    />
  )
}
