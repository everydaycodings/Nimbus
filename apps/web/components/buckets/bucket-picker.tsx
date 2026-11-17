"use client"

import { Combobox } from "@base-ui/react/combobox"
import { CheckIcon, XIcon } from "@phosphor-icons/react"
import { useRef, useState } from "react"

import { CHIP } from "@/components/buckets/bucket-chips"
import { MENU_POPUP } from "@/components/overlay-styles"
import { formatBytes } from "@/lib/file-rules"
import { cn } from "@/lib/utils"

export type Opt = { id: string; name: string; bytes: number }

const FIELD =
  "flex min-h-9 w-full items-center rounded-md border border-input bg-input/20 px-2 py-1 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 pointer-coarse:min-h-11"
const INPUT = "h-6 min-w-24 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
const LINK_BTN =
  "rounded-sm text-xs text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:min-h-11"
// Chips shown in the field before the rest fold into "+N more", so it stays within two rows.
const CHIPS = 3

function Popup({ anchor }: { anchor: React.RefObject<HTMLElement | null> }) {
  return (
    <Combobox.Portal>
      <Combobox.Positioner anchor={anchor} side="bottom" align="start" sideOffset={4} className="z-50">
        <Combobox.Popup className={cn("w-(--anchor-width) max-w-[calc(100vw-2rem)]", MENU_POPUP)}>
          <Combobox.Empty className="px-2 py-3 text-center text-sm text-muted-foreground empty:hidden">No bucket matches</Combobox.Empty>
          <Combobox.List className="max-h-72 overflow-y-auto">{(b: Opt) => <Option key={b.id} b={b} />}</Combobox.List>
        </Combobox.Popup>
      </Combobox.Positioner>
    </Combobox.Portal>
  )
}

function Option({ b }: { b: Opt }) {
  return (
    <Combobox.Item
      value={b}
      className="flex min-h-8 cursor-default items-center gap-2 rounded-md px-2 text-sm outline-none select-none data-highlighted:bg-accent pointer-coarse:min-h-11"
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        <Combobox.ItemIndicator>
          <CheckIcon className="size-4" />
        </Combobox.ItemIndicator>
      </span>
      <span className="min-w-0 flex-1 truncate font-mono" title={b.name}>
        {b.name}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatBytes(b.bytes)}</span>
    </Combobox.Item>
  )
}

// A searchable multi-select of buckets: picks show as chips in the field (extra ones fold into "+N more"),
// the list scrolls, and picked buckets sit at the top each time it opens.
export function BucketPicker({
  buckets,
  value,
  onChange,
  label = "Buckets",
}: {
  buckets: Opt[]
  value: string[]
  onChange: (ids: string[]) => void
  label?: string
}) {
  const [query, setQuery] = useState("")
  // The picks as they were when the list opened, so the order doesn't jump while ticking.
  const [pinned, setPinned] = useState(value)
  const input = useRef<HTMLInputElement>(null)
  const field = useRef<HTMLDivElement>(null)
  const picked = buckets.filter((b) => value.includes(b.id))
  const ordered = [...buckets.filter((b) => pinned.includes(b.id)), ...buckets.filter((b) => !pinned.includes(b.id))]
  const q = query.trim().toLowerCase()
  const matching = ordered.filter((b) => b.name.includes(q))
  return (
    <div className="grid gap-1.5">
      <Combobox.Root
        multiple
        items={matching}
        filter={null}
        value={picked}
        onValueChange={(next: Opt[]) => onChange(next.map((b) => b.id))}
        inputValue={query}
        onInputValueChange={setQuery}
        onOpenChange={(o) => o && setPinned(value)}
        itemToStringLabel={(b: Opt) => b.name}
        itemToStringValue={(b: Opt) => b.id}
      >
        <Combobox.Chips ref={field} className={cn(FIELD, "max-h-[4.75rem] flex-wrap gap-1.5 overflow-y-auto pointer-coarse:max-h-24")}>
          {picked.slice(0, CHIPS).map((b) => (
            <Combobox.Chip key={b.id} className={cn(CHIP, "flex items-center gap-1 pr-1 outline-none data-highlighted:ring-[3px] data-highlighted:ring-ring/50")}>
              <span className="truncate" title={b.name}>
                {b.name}
              </span>
              <Combobox.ChipRemove
                aria-label={`Remove ${b.name}`}
                className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:size-7"
              >
                <XIcon className="size-3" />
              </Combobox.ChipRemove>
            </Combobox.Chip>
          ))}
          {picked.length > CHIPS && (
            <button
              type="button"
              onClick={() => input.current?.focus()}
              className="rounded-md border px-2 py-0.5 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              +{picked.length - CHIPS} more
            </button>
          )}
          <Combobox.Input ref={input} aria-label={label} placeholder={picked.length ? "" : "Search buckets…"} className={INPUT} />
        </Combobox.Chips>
        <Popup anchor={field} />
      </Combobox.Root>
      <div className="flex gap-3">
        <button type="button" className={LINK_BTN} disabled={!matching.length} onClick={() => onChange([...new Set([...value, ...matching.map((b) => b.id)])])}>
          Select all matching{q ? ` (${matching.length})` : ""}
        </button>
        <button type="button" className={LINK_BTN} disabled={!value.length} onClick={() => onChange([])}>
          Clear
        </button>
      </div>
    </div>
  )
}

// The same list for picking one bucket.
export function BucketSelect({ buckets, value, onChange, label }: { buckets: Opt[]; value: string; onChange: (name: string) => void; label: string }) {
  const [query, setQuery] = useState("")
  const field = useRef<HTMLDivElement>(null)
  const current = buckets.find((b) => b.name === value) ?? null
  const q = query.trim().toLowerCase()
  const matching = buckets.filter((b) => b.name.includes(q))
  return (
    <Combobox.Root
      items={matching}
      filter={null}
      value={current}
      onValueChange={(b: Opt | null) => b && onChange(b.name)}
      onInputValueChange={(v, d) => setQuery(d.reason === "input-change" ? v : "")}
      itemToStringLabel={(b: Opt) => b.name}
      itemToStringValue={(b: Opt) => b.id}
    >
      <div ref={field} className={cn(FIELD, "w-56 max-w-full font-mono")}>
        <Combobox.Input aria-label={label} placeholder="Search buckets…" className={cn(INPUT, "font-mono text-xs")} />
      </div>
      <Popup anchor={field} />
    </Combobox.Root>
  )
}
