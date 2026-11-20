"use client"

import { ArchiveIcon } from "@phosphor-icons/react"
import Link from "next/link"

import { NeedsBrowser } from "./needs-browser"
import { AddPages } from "./add-pages"
import { Library } from "./library"
import { Settings } from "./settings"
import { useLibrary } from "./use-library"
import type { CookieView, PageView } from "@/lib/archive/run"
import { Empty } from "@/components/registry-ui"

const BASE = "/more/archive"

export function Shell(props: {
  pages: PageView[]
  browser: "off" | "down" | "ok"
  admin: boolean
  tab: "library" | "settings"
  folder: { id: string; path: string } | null
  cookies: CookieView[]
  appUrl: string
}) {
  const { pages, stale, refresh } = useLibrary(props.pages)
  const ready = props.browser === "ok"
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Website archive</h1>
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">
          Save web pages as a single HTML file, a PDF, a screenshot and plain text, kept in your Files where search finds them. Pages you schedule are captured again, and a new version is kept only when the text changed.
        </p>
      </header>

      {!ready && <NeedsBrowser state={props.browser === "down" ? "down" : "off"} admin={props.admin} />}

      <nav role="tablist" aria-label="Website archive sections" className="flex w-fit max-w-full overflow-x-auto rounded-lg bg-muted p-[3px]">
        {([["library", "Library"], ["settings", "Settings"]] as const).map(([t, text]) => (
          <Link
            key={t}
            href={t === "library" ? BASE : `${BASE}?tab=${t}`}
            role="tab"
            aria-selected={props.tab === t}
            aria-current={props.tab === t ? "page" : undefined}
            className="flex h-7 items-center rounded-md border border-transparent px-3 text-sm whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:h-11 aria-[current=page]:border-input aria-[current=page]:bg-input/30 aria-[current=page]:text-foreground"
          >
            {text}
          </Link>
        ))}
      </nav>

      {props.tab === "settings" ? (
        <Settings folder={props.folder} cookies={props.cookies} />
      ) : (
        <>
          <AddPages ready={ready} appUrl={props.appUrl} onAdded={refresh} folder={props.folder} />
          {stale && <p role="status" className="text-sm text-muted-foreground">Can&apos;t reach the server. Showing the last list; trying again.</p>}
          {pages.length === 0 ? (
            <Empty icon={ArchiveIcon} title="No pages saved yet">
              <p>Paste a few addresses above, import your browser bookmarks, or add the bookmarklet to save a page from anywhere.</p>
            </Empty>
          ) : (
            <Library pages={pages} />
          )}
        </>
      )}
    </div>
  )
}
