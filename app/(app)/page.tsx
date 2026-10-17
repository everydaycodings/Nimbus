import { FileBrowser } from "@/components/file-browser"
import {
  listFolder,
  pageUserId,
  purgeExpiredTrash,
  viewPrefs,
  listTags,
} from "@/lib/files"

export default async function MyFilesPage() {
  const me = await pageUserId()
  await purgeExpiredTrash()
  const [items, prefs, tags] = await Promise.all([
    listFolder(me, null),
    viewPrefs(),
    listTags(me),
  ])

  return (
    <FileBrowser
      view="folder"
      title="My files"
      items={items}
      empty={{
        title: "No files yet",
        body: "Make a folder to start organizing (Shift+N). Uploading files arrives in the next update of Nimbus.",
      }}
      tags={tags}
      {...prefs}
    />
  )
}
