import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { FileBrowser } from "@/components/file-browser"
import { listByTag, listTags, pageUserId, viewPrefs } from "@/lib/files"

type Props = { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const tag = (await listTags(await pageUserId())).find((t) => t.id === id)
  return { title: tag ? `${tag.name} · Nimbus` : "Nimbus" }
}

export default async function TagPage({ params }: Props) {
  const { id } = await params
  const me = await pageUserId()
  const tags = await listTags(me)
  const tag = tags.find((t) => t.id === id)
  if (!tag) notFound()
  const [items, prefs] = await Promise.all([listByTag(me, id), viewPrefs()])

  return (
    <FileBrowser
      view="tag"
      title={tag.name}
      items={items}
      empty={{
        title: "Nothing tagged",
        body: `Items you tag “${tag.name}” show up here. Right-click a file or folder and pick Tags.`,
      }}
      tags={tags}
      {...prefs}
    />
  )
}
