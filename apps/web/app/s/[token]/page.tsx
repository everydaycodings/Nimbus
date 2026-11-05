import { CloudIcon, LinkBreakIcon } from "@phosphor-icons/react/dist/ssr"
import type { Metadata } from "next"
import Link from "next/link"

import {
  DropZone,
  PasswordGate,
  PublicFile,
  PublicFolder,
} from "@/components/public-link"
import { getItem, listFolder } from "@/lib/files"
import type { Item } from "@/lib/files"
import { findLink, linkNode, logLinkEvent, unlocked } from "@/lib/links"
import { visiblePath } from "@/lib/access"

type Props = {
  params: Promise<{ token: string }>
  searchParams: Promise<{ f?: string }>
}

export const metadata: Metadata = {
  title: "Shared with you · Nimbus",
  robots: { index: false, follow: false },
}

// Visitors see the item, never the owner's tags, stars or other shares.
const bare = (i: Item): Item => ({
  ...i,
  tags: [],
  starred: false,
  sharedWithPeople: false,
  hasLink: false,
})

export default async function LinkPage({ params, searchParams }: Props) {
  const { token } = await params
  const { f } = await searchParams
  const link = await findLink(token)

  if (!link)
    return (
      <Shell>
        <div className="mx-auto flex max-w-sm flex-col items-center gap-3 py-24 text-center">
          <LinkBreakIcon className="size-10 text-muted-foreground" />
          <h1 className="text-lg font-semibold">This link doesn&apos;t work</h1>
          <p className="text-sm text-muted-foreground">
            It may have expired or been turned off. Ask the person who sent it
            for a new one.
          </p>
        </div>
      </Shell>
    )

  if (!(await unlocked(link)))
    return (
      <Shell>
        <div className="py-16">
          <PasswordGate token={token} />
        </div>
      </Shell>
    )

  await logLinkEvent(link.id, "view")
  const by = `Shared by ${link.ownerName}`

  if (link.kind === "file") {
    const item = await getItem(link.ownerId, link.nodeId)
    return (
      <Shell by={by}>
        {item && (
          <PublicFile
            token={token}
            item={bare(item)}
            download={link.allowDownload}
          />
        )}
      </Shell>
    )
  }

  const inside = f ? await linkNode(link, f) : null
  const folderId = inside?.kind === "folder" ? inside.id : link.nodeId
  const [items, full] = await Promise.all([
    link.allowView
      ? listFolder(link.ownerId, link.ownerId, folderId)
      : Promise.resolve([]),
    visiblePath(link.ownerId, folderId),
  ])
  // Breadcrumbs start at the link's folder.
  const path = full.slice(full.findIndex((p) => p.id === link.nodeId))

  return (
    <Shell by={by}>
      <div className="flex flex-col gap-6">
        {link.allowView ? (
          <PublicFolder
            token={token}
            items={items.map(bare)}
            path={path}
            view
            download={link.allowDownload}
          />
        ) : (
          <h1 className="text-2xl font-semibold tracking-tight">
            {link.itemName}
          </h1>
        )}
        {link.allowUpload && (
          <DropZone
            token={token}
            folderId={folderId}
            tusUrl={process.env.TUS_URL ?? ""}
          />
        )}
      </div>
    </Shell>
  )
}

function Shell({ by, children }: { by?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="flex h-14 items-center gap-3 border-b px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-md text-sm font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <CloudIcon weight="fill" className="size-5 text-brand" />
          Nimbus
        </Link>
        {by && (
          <span className="ml-auto truncate text-sm text-muted-foreground">
            {by}
          </span>
        )}
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col p-4 sm:p-6 lg:p-10">
        {children}
      </main>
    </div>
  )
}
