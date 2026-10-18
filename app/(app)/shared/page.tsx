import Link from "next/link"

import { FileBrowser } from "@/components/file-browser"
import {
  listShared,
  listSharedByMe,
  pageUserId,
  viewPrefs,
  listTags,
} from "@/lib/files"
import { cn } from "@/lib/utils"

export const metadata = { title: "Shared files · Nimbus" }

type Props = { searchParams: Promise<{ by?: string }> }

export default async function SharedPage({ searchParams }: Props) {
  const byMe = (await searchParams).by === "me"
  const me = await pageUserId()
  const [items, prefs, tags] = await Promise.all([
    byMe ? listSharedByMe(me) : listShared(me),
    viewPrefs(),
    listTags(me),
  ])

  return (
    <FileBrowser
      // Remounts on switch, so selection and sort don't carry over.
      key={byMe ? "by-me" : "with-me"}
      view={byMe ? "sharedByMe" : "shared"}
      title="Shared files"
      tabs={
        <nav aria-label="Shared files" className="-mt-2 flex gap-1 border-b">
          <Tab href="/shared" current={!byMe}>
            Shared with me
          </Tab>
          <Tab href="/shared?by=me" current={byMe}>
            Shared by me
          </Tab>
        </nav>
      }
      items={items}
      empty={
        byMe
          ? {
              title: "You haven't shared anything yet",
              body: "Files and folders you share with people or by link show up here.",
            }
          : {
              title: "Nothing shared with you yet",
              body: "When someone on this Nimbus shares a file or folder with you, it shows up here.",
            }
      }
      tags={tags}
      {...prefs}
    />
  )
}

function Tab({
  href,
  current,
  children,
}: {
  href: string
  current: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "-mb-px border-b-2 px-3 py-2 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        current
          ? "border-brand text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </Link>
  )
}
