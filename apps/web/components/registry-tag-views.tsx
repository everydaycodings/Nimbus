"use client"

import { GitDiffIcon } from "@phosphor-icons/react"
import Link from "next/link"
import { useState } from "react"

import { BaseImageView } from "@/components/registry-advice"
import { PackagesView } from "@/components/registry-packages"
import { VIEWS, compareHref, type View } from "@/components/registry-links"
import { Segmented, SELECT, TOUCH } from "@/components/registry-ui"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// What the selected tag shows under its row: layers and config, packages, a way into Compare, and base image advice.
export function TagViews({
  name,
  tag,
  platforms,
  others,
  canWrite,
  initial,
  overview,
}: {
  name: string
  tag: string
  platforms: string[]
  // Other tags of the repo, newest first, to compare against.
  others: string[]
  canWrite: boolean
  initial: View
  overview: React.ReactNode
}) {
  const [view, setView] = useState<View>(initial)
  const [other, setOther] = useState(others[0] ?? "")
  return (
    <div className="grid gap-4">
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <Segmented
          label={`Views of ${tag}`}
          value={view}
          options={VIEWS}
          onChange={setView}
        />
      </div>
      {view === "overview" && overview}
      {view === "packages" && (
        <PackagesView name={name} tag={tag} platforms={platforms} />
      )}
      {view === "base" && (
        <BaseImageView name={name} tag={tag} canRefresh={canWrite} />
      )}
      {view === "compare" &&
        (others.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This is the only tag here. Push another to compare them.
          </p>
        ) : (
          <div className="grid gap-2">
            <p className="text-sm text-pretty text-muted-foreground">
              See what changed between another tag and{" "}
              <span className="font-mono">{tag}</span>: packages,
              vulnerabilities, size and layers.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-sm">
                Compare with
                <select
                  value={other}
                  onChange={(e) => setOther(e.target.value)}
                  className={cn(
                    SELECT,
                    "max-w-56 font-mono pointer-coarse:h-11"
                  )}
                >
                  {others.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </label>
              <Button
                render={<Link href={compareHref(name, other, tag)} />}
                nativeButton={false}
                size="sm"
                className={TOUCH}
              >
                <GitDiffIcon />
                Compare
              </Button>
            </div>
          </div>
        ))}
    </div>
  )
}
