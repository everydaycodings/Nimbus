import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { FileBrowser } from "@/components/file-browser"
import { visiblePath } from "@/lib/access"
import {
  getFolder,
  listFolder,
  pageUserId,
  viewPrefs,
  listTags,
} from "@/lib/files"

type Props = { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const folder = await getFolder(await pageUserId(), (await params).id)
  return { title: folder ? `${folder.name} · Nimbus` : "Nimbus" }
}

export default async function FolderPage({ params }: Props) {
  const { id } = await params
  const me = await pageUserId()
  const folder = await getFolder(me, id)
  if (!folder) notFound()
  const [items, path, prefs, tags] = await Promise.all([
    listFolder(me, folder.ownerId, id, folder.role),
    visiblePath(me, id),
    viewPrefs(),
    listTags(me),
  ])

  return (
    <FileBrowser
      key={id}
      view="folder"
      folderId={id}
      path={path}
      role={folder.role}
      title={folder.name}
      items={items}
      empty={{
        title: "This folder is empty",
        body:
          folder.role === "viewer"
            ? "Nothing has been added here yet."
            : "Drop files here to upload them, make a folder (Shift+N), or drag things in from another folder.",
      }}
      tags={tags}
      {...prefs}
    />
  )
}
