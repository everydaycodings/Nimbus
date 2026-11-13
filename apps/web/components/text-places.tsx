"use client"

import { Fragment, useState } from "react"

import type { TextPlace } from "@nimbus/shared/api"
import { cn } from "@/lib/utils"

export type PlaceStart = { page?: number; tMs?: number; box?: [number, number, number, number] }

// Where the previewer should open for a match.
export const startOf = (p: TextPlace): PlaceStart => ({ page: p.page, tMs: p.tMs, box: p.box })

export function clock(ms: number) {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, "0")
  return h ? `${h}:${String(mm).padStart(2, "0")}:${ss}` : `${mm}:${ss}`
}

// "p. 4", "12:30" or "In image".
export function placeLabel(p: TextPlace) {
  if (p.kind === "page" && p.page !== undefined) return `p. ${p.page}`
  if (p.kind === "time" && p.tMs !== undefined) return clock(p.tMs)
  return "In image"
}

// ts_headline marks matches with \u0001…\u0002.
export function Snippet({ text }: { text: string }) {
  return text.split("\u0001").map((part, i) => {
    const [hit, rest] = part.includes("\u0002") ? part.split("\u0002") : ["", part]
    return (
      <Fragment key={i}>
        {hit && <mark className="rounded-sm bg-brand/20 text-foreground">{hit}</mark>}
        {rest}
      </Fragment>
    )
  })
}

// Up to three places a search matched inside a file, and "N more" to list the rest.
// `stop` keeps clicks from selecting or opening the tile they sit in.
export function Places({
  id,
  q,
  places,
  more,
  onOpen,
  stop = false,
  className,
}: {
  id: string
  q: string
  places: TextPlace[]
  more: number
  onOpen: (p: TextPlace) => void
  stop?: boolean
  className?: string
}) {
  const [all, setAll] = useState<TextPlace[] | null>(null)
  const [state, setState] = useState<"idle" | "loading" | "failed">("idle")
  const shown = all ?? places

  async function load() {
    setState("loading")
    try {
      const r = await fetch(`/api/v1/files/${id}/text?q=${encodeURIComponent(q)}`)
      if (!r.ok) throw new Error()
      setAll(((await r.json()) as { parts: TextPlace[] }).parts)
      setState("idle")
    } catch {
      setState("failed")
    }
  }

  const swallow = stop
    ? {
        onClick: (e: React.SyntheticEvent) => e.stopPropagation(),
        onDoubleClick: (e: React.SyntheticEvent) => e.stopPropagation(),
        onKeyDown: (e: React.KeyboardEvent) => e.stopPropagation(),
      }
    : {}

  return (
    <div {...swallow} className={cn("flex flex-col", className)}>
      <ul
        aria-label="Matches in this file"
        className={cn("flex flex-col", all && "max-h-48 overflow-y-auto")}
      >
        {shown.map((p, n) => (
          <li key={n} className="min-w-0">
            <button
              type="button"
              onClick={() => onOpen(p)}
              className="flex w-full min-w-0 items-baseline gap-2 rounded-md px-1.5 py-1 pointer-coarse:py-2 text-left text-xs text-muted-foreground outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <span className="shrink-0 rounded bg-muted px-1.5 py-px font-medium text-foreground tabular-nums">
                {placeLabel(p)}
              </span>
              <span className="min-w-0 truncate">
                …<Snippet text={p.snippet} />…
              </span>
            </button>
          </li>
        ))}
      </ul>
      {more > 0 && (
        <button
          type="button"
          disabled={state === "loading"}
          onClick={all ? () => setAll(null) : load}
          className="self-start rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60"
        >
          {all
            ? "Show fewer"
            : state === "loading"
              ? "Loading…"
              : state === "failed"
                ? "Couldn't load. Try again"
                : `${more} more`}
        </button>
      )}
    </div>
  )
}
