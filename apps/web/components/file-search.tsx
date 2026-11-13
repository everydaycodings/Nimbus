"use client"

import { CaretDownIcon, CaretUpIcon, MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react"
import { useEffect, useRef, useState } from "react"

import type { TextPlace } from "@nimbus/shared/api"
import { Button } from "@/components/ui/button"

// The previewer's find-in-file box: lists every place the text matches, and steps
// through them with Enter / Shift+Enter or the arrows.
export function FileSearch({
  id,
  onJump,
  onClose,
}: {
  id: string
  onJump: (p: TextPlace) => void
  onClose: () => void
}) {
  const [q, setQ] = useState("")
  // parts: null when the lookup failed.
  const [res, setRes] = useState<{ q: string; parts: TextPlace[] | null } | null>(null)
  const [at, setAt] = useState(0)
  const latest = useRef(0)
  const text = q.trim()

  useEffect(() => {
    if (!text) return
    const n = ++latest.current
    const timer = setTimeout(async () => {
      let parts: TextPlace[] | null = null
      try {
        const r = await fetch(`/api/v1/files/${id}/text?q=${encodeURIComponent(text)}`)
        if (r.ok) parts = ((await r.json()) as { parts: TextPlace[] }).parts
      } catch {}
      if (n !== latest.current) return
      setRes({ q: text, parts })
      setAt(0)
      if (parts?.[0]) onJump(parts[0])
    }, 300)
    return () => clearTimeout(timer)
    // onJump changes every render; the lookup should only follow the text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, id])

  const parts = res && res.q === text ? res.parts : undefined
  const total = parts?.length ?? 0

  function step(by: number) {
    if (!parts?.length) return
    const next = (at + by + parts.length) % parts.length
    setAt(next)
    onJump(parts[next])
  }

  const status = !text
    ? ""
    : parts === undefined
      ? "Searching…"
      : parts === null
        ? "Couldn't search"
        : total
          ? `${at + 1} of ${total}`
          : "No matches"

  return (
    <div
      role="search"
      className="absolute top-2 right-2 z-20 flex max-w-[calc(100%-1rem)] items-center gap-1 rounded-full border bg-background/90 p-1 pl-3 shadow-lg backdrop-blur-sm sm:right-16"
    >
      <MagnifyingGlassIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <input
        autoFocus
        id="file-search-input"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return
          e.preventDefault()
          step(e.shiftKey ? -1 : 1)
        }}
        aria-label="Search in this file"
        placeholder="Find in file"
        className="h-8 w-28 min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground sm:w-48 [&::-webkit-search-cancel-button]:hidden"
      />
      <span
        role="status"
        className="min-w-14 shrink-0 text-right text-xs text-muted-foreground tabular-nums"
      >
        {status}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        className="rounded-full"
        aria-label="Previous match"
        title="Previous (Shift+Enter)"
        disabled={total < 2}
        onClick={() => step(-1)}
      >
        <CaretUpIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="rounded-full"
        aria-label="Next match"
        title="Next (Enter)"
        disabled={total < 2}
        onClick={() => step(1)}
      >
        <CaretDownIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="rounded-full"
        aria-label="Close search"
        title="Close (Esc)"
        onClick={onClose}
      >
        <XIcon />
      </Button>
    </div>
  )
}
