"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"

import { Hooks, PolicyEditor } from "@/components/registry-extra"
import { AccessSection, ArchiveSection, DeleteSection, GeneralSection, ImmutableSection, RenameSection } from "@/components/registry-settings"
import { SigningSection } from "@/components/registry-builds"
import { Heading, SECTION } from "@/components/registry-ui"
import type { HookRow, RepoAccess, RepoDetail } from "@/lib/registry/manage"
import { cn } from "@/lib/utils"

export type RepoTab = "overview" | "tags" | "builds" | "activity" | "settings"

// Same segmented look as the registry's own tabs; the choice lives in ?tab= so a tab can be linked to.
export function RepoTabs({ name, tab, tabs }: { name: string; tab: RepoTab; tabs: [RepoTab, string][] }) {
  const nav = useRef<HTMLElement>(null)
  // On a narrow screen the row scrolls; a fade on the right edge says there is more.
  const [more, setMore] = useState(false)
  useEffect(() => {
    const el = nav.current
    if (!el) return
    const check = () => setMore(el.scrollWidth - el.scrollLeft - el.clientWidth > 4)
    check()
    el.addEventListener("scroll", check, { passive: true })
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => {
      el.removeEventListener("scroll", check)
      ro.disconnect()
    }
  }, [])
  return (
    <nav
      ref={nav}
      aria-label="Repository sections"
      className="flex w-fit max-w-full overflow-x-auto rounded-lg bg-muted p-[3px]"
      style={more ? { maskImage: "linear-gradient(to right, black calc(100% - 2rem), transparent)" } : undefined}
    >
      {tabs.map(([id, label]) => (
        <Link
          key={id}
          href={id === "overview" ? `/registry/${name}` : `/registry/${name}?tab=${id}`}
          aria-current={tab === id ? "page" : undefined}
          className="flex h-7 items-center rounded-md border border-transparent px-3 text-sm whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:h-11 aria-[current=page]:border-input aria-[current=page]:bg-input/30 aria-[current=page]:text-foreground"
        >
          {label}
        </Link>
      ))}
    </nav>
  )
}

const NAV = [
  ["general", "General"],
  ["signing", "Image signing"],
  ["access", "Access"],
  ["tags-cleanup", "Tags & cleanup"],
  ["webhooks", "Webhooks"],
  ["advanced", "Advanced"],
] as const

export function RepoSettings({
  repo,
  hooks,
  scanOn,
  access,
  targets,
  signing,
}: {
  repo: RepoDetail
  hooks: HookRow[]
  scanOn: boolean
  access: RepoAccess | null
  targets: string[]
  // Set when builds are on: the host and the server's public cosign key.
  signing?: { host: string; key: string | null; signedTag: string | null }
}) {
  if (!repo.canWrite) return null
  const links = NAV.filter(([id]) => (id === "access" ? access : id === "webhooks" ? repo.isOwner : id === "signing" ? signing : true))
  return (
    <div className="lg:grid lg:grid-cols-[9rem_minmax(0,1fr)] lg:items-start lg:gap-10">
      <nav aria-label="Settings sections" className="sticky top-6 hidden flex-col gap-0.5 lg:flex">
        {links.map(([id, label]) => (
          <a
            key={id}
            href={`#${id}`}
            className="rounded-md px-2 py-1.5 text-sm text-muted-foreground outline-none hover:bg-accent/50 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {label}
          </a>
        ))}
      </nav>
      <div className="flex min-w-0 flex-col gap-10">
        <GeneralSection repo={repo} scanOn={scanOn} />

        {signing && <SigningSection host={signing.host} name={repo.fullName} publicKey={signing.key} signedTag={signing.signedTag} />}

        {access && <AccessSection repo={repo} access={access} />}

        <div id="tags-cleanup" className="flex scroll-mt-20 flex-col gap-10">
          <ImmutableSection repo={repo} />
          <section className={SECTION} aria-labelledby="cleanup-heading">
            <Heading id="cleanup-heading" title="Cleanup" hint="Tidy old tags automatically. Removed tags go to Trash first." />
            <div className="rounded-xl border bg-card p-4">
              <PolicyEditor namespace={repo.namespace} repo={repo.fullName} initial={repo.policy} inherited={repo.nsPolicy} />
            </div>
          </section>
        </div>

        {repo.isOwner && (
          <section id="webhooks" className={cn(SECTION, "scroll-mt-20")} aria-labelledby="hooks-heading">
            <Heading
              id="hooks-heading"
              title="Webhooks"
              hint="Get a signed POST when an image is pushed, deleted, scanned or built here. Webhooks on the registry name cover this repository too."
            />
            <div className="rounded-xl border bg-card p-4">
              <Hooks namespace={repo.namespace} repo={repo.fullName.slice(repo.namespace.length + 1)} initial={hooks} />
            </div>
          </section>
        )}

        <section id="advanced" className={cn(SECTION, "scroll-mt-20 gap-6")} aria-labelledby="advanced-heading">
          <Heading id="advanced-heading" title="Advanced" hint="Rename, freeze or remove this repository." />
          {repo.canAdmin && <RenameSection repo={repo} targets={targets} />}
          {repo.canAdmin && <ArchiveSection repo={repo} />}
          <DeleteSection repo={repo} />
        </section>
      </div>
    </div>
  )
}
