import { CloudIcon, LinkBreakIcon } from "@phosphor-icons/react/dist/ssr"
import type { Metadata } from "next"
import Link from "next/link"

import { unlockAlbumLink } from "@/app/a/actions"
import { AlbumView } from "@/components/album-view"
import { PasswordGate } from "@/components/public-link"
import {
  albumPageLimited,
  albumPhotos,
  albumUnlocked,
  countAlbumView,
  findAlbumLink,
} from "@/lib/album-links"

type Props = { params: Promise<{ token: string }> }

export const metadata: Metadata = {
  title: "Album · Nimbus",
  robots: { index: false, follow: false },
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Shell>
      <div className="mx-auto flex max-w-sm flex-col items-center gap-3 py-24 text-center">
        <LinkBreakIcon className="size-10 text-muted-foreground" />
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{children}</p>
      </div>
    </Shell>
  )
}

// A shared album: view-only, never any location data.
export default async function AlbumPage({ params }: Props) {
  const { token } = await params
  if (await albumPageLimited())
    return <Notice title="Too many requests">Wait a minute and try again.</Notice>
  const link = await findAlbumLink(token)

  if (!link)
    return (
      <Notice title="This link doesn't work">
        It may have expired or been turned off. Ask the person who sent it for a
        new one.
      </Notice>
    )

  if (!(await albumUnlocked(link)))
    return (
      <Shell>
        <div className="py-16">
          <PasswordGate token={token} unlock={unlockAlbumLink} />
        </div>
      </Shell>
    )

  await countAlbumView(link.id)
  const items = await albumPhotos(link)

  return (
    <Shell by={`Shared by ${link.ownerName}`}>
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{link.name}</h1>
        <AlbumView token={token} items={items} download={link.allowDownload} />
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
          <span className="ml-auto truncate text-sm text-muted-foreground">{by}</span>
        )}
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col p-4 sm:p-6 lg:p-10">
        {children}
      </main>
    </div>
  )
}
