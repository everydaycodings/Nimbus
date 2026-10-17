import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { FileBrowser } from "@/components/file-browser"
import {
  getFolder,
  getPath,
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
    listFolder(me, id),
    getPath(id),
    viewPrefs(),
    listTags(me),
  ])

  return (
    <FileBrowser
      key={id}
      view="folder"
      folderId={id}
      path={path}
      title={folder.name}
      items={items}
      empty={{
        title: "This folder is empty",
        body: "Drop files here to upload them, make a folder (Shift+N), or drag things in from another folder.",
      }}
      tags={tags}
      {...prefs}
    />
  )
}
