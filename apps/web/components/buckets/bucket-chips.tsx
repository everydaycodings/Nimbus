"use client"

import { Popover } from "@base-ui/react/popover"
import { useState } from "react"

import { MENU_POPUP } from "@/components/overlay-styles"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export const CHIP = "max-w-40 truncate rounded-md bg-accent px-2 py-0.5 font-mono text-xs"

// Bucket names as mono chips: the first `max`, then a "+N" button that opens the whole list with its own search.
export function BucketChips({ names, max = 2, className }: { names: string[]; max?: number; className?: string }) {
  const [q, setQ] = useState("")
  const rest = names.length - max
  const shown = names.filter((n) => n.includes(q.trim().toLowerCase()))
  return (
    <span className={cn("flex flex-wrap items-center gap-1", className)}>
      {names.slice(0, max).map((n) => (
        <span key={n} className={CHIP} title={n}>
          {n}
        </span>
      ))}
      {rest > 0 && (
        <Popover.Root onOpenChange={() => setQ("")}>
          <Popover.Trigger
            aria-label={`Show all ${names.length} buckets`}
            className="rounded-md border px-2 py-0.5 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:min-h-11 pointer-coarse:px-3"
          >
            +{rest}
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner side="bottom" align="start" sideOffset={4} className="z-50">
              <Popover.Popup className={cn("flex w-64 max-w-[calc(100vw-2rem)] flex-col gap-1", MENU_POPUP)}>
                <Popover.Title className="sr-only">Buckets</Popover.Title>
                <Input type="search" aria-label="Search these buckets" placeholder="Search buckets…" value={q} onChange={(e) => setQ(e.target.value)} className="h-8" />
                <ul className="max-h-60 overflow-y-auto">
                  {shown.map((n) => (
                    <li key={n} className="truncate rounded-md px-2 py-1.5 font-mono text-xs" title={n}>
                      {n}
                    </li>
                  ))}
                  {shown.length === 0 && <li className="px-2 py-3 text-center text-sm text-muted-foreground">No bucket matches</li>}
                </ul>
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      )}
    </span>
  )
}
