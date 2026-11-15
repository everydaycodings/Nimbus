"use client"

import { ArrowLineDownIcon, DownloadSimpleIcon, MagnifyingGlassIcon } from "@phosphor-icons/react"
import { useEffect, useMemo, useRef, useState } from "react"

import { CopyButton } from "@/components/copy-button"
import { TOUCH } from "@/components/registry-ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

// Colour codes and carriage-return redraws from the build tools are noise in plain text.
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g
export const cleanLine = (s: string) => s.replace(ANSI, "").replace(/\r/g, "")

// Past this many lines only the newest are drawn; "Show all" draws the rest (still one DOM row per line, so it is capped).
const SHOWN = 1500
const HARD_CAP = 20000

// ponytail: plain list, newest SHOWN lines. A windowed list is the upgrade if a 20k line log feels slow.
export function LogViewer({
  lines,
  live,
  truncated,
  onLoadFull,
  loadingFull,
  filename,
}: {
  lines: string[]
  live: boolean
  // The log is only the tail of what was written; offer the full one.
  truncated?: boolean
  onLoadFull?: () => void
  loadingFull?: boolean
  filename: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const [follow, setFollow] = useState(true)
  const [q, setQ] = useState("")
  const [all, setAll] = useState(false)

  const clean = useMemo(() => lines.slice(-HARD_CAP).map(cleanLine), [lines])
  const needle = q.trim().toLowerCase()
  const rows = useMemo(() => {
    const numbered = clean.map((text, i) => ({ n: i + 1 + (lines.length - clean.length), text }))
    return needle ? numbered.filter((r) => r.text.toLowerCase().includes(needle)) : numbered
  }, [clean, needle, lines.length])
  const shown = all || needle ? rows : rows.slice(-SHOWN)
  const hidden = rows.length - shown.length

  // Follow the end while the reader hasn't scrolled up.
  useEffect(() => {
    const el = box.current
    if (el && follow) el.scrollTop = el.scrollHeight
  }, [shown.length, follow])

  const onScroll = () => {
    const el = box.current
    if (!el) return
    setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 24)
  }
  const jump = () => {
    setFollow(true)
    const el = box.current
    if (el) el.scrollTop = el.scrollHeight
  }
  const text = clean.join("\n")
  const download = () => {
    const url = URL.createObjectURL(new Blob([text + "\n"], { type: "text/plain" }))
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-48">
          <MagnifyingGlassIcon aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter the log"
            aria-label="Filter the log"
            className="pl-8 pointer-coarse:h-11"
            spellCheck={false}
          />
        </div>
        <CopyButton value={text} label="Copy the whole log" className={TOUCH} />
        <Button type="button" variant="outline" size="sm" className={TOUCH} onClick={download} disabled={!clean.length}>
          <DownloadSimpleIcon />
          Download
        </Button>
      </div>
      <div className="relative min-w-0">
        <div
          ref={box}
          onScroll={onScroll}
          role="log"
          aria-label="Build log"
          aria-live="off"
          tabIndex={0}
          className="max-h-[min(32rem,70dvh)] min-h-16 overflow-auto rounded-xl border bg-input/20 py-2 font-mono text-xs leading-5 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {truncated && !all && (
            <div className="sticky left-0 flex flex-wrap items-center gap-2 px-3 pb-2 font-sans text-muted-foreground">
              <span>Showing the end of a long log.</span>
              <Button type="button" variant="outline" size="sm" className={TOUCH} disabled={loadingFull} onClick={onLoadFull}>
                {loadingFull ? "Loading…" : "Load full log"}
              </Button>
            </div>
          )}
          {hidden > 0 && (
            <div className="sticky left-0 px-3 pb-2 font-sans">
              <Button type="button" variant="outline" size="sm" className={TOUCH} onClick={() => setAll(true)}>
                Show {hidden.toLocaleString()} earlier lines
              </Button>
            </div>
          )}
          {shown.length === 0 ? (
            <p className="sticky left-0 px-3 font-sans text-sm text-muted-foreground">
              {needle ? "No lines match." : live ? "Waiting for the first line…" : "This build wrote no log."}
            </p>
          ) : (
            <ol className="w-max min-w-full">
              {shown.map((r) => (
                <li key={r.n} className="flex hover:bg-accent/30">
                  <span aria-hidden className="sticky left-0 w-12 shrink-0 bg-input/20 pr-3 text-right text-muted-foreground tabular-nums select-none">
                    {r.n}
                  </span>
                  <span className={cn("pr-3 whitespace-pre", /\b(error|failed|denied)\b/i.test(r.text) && "text-destructive")}>{r.text || " "}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
        {!follow && live && (
          <Button type="button" size="sm" onClick={jump} className={cn("absolute right-3 bottom-3 shadow-md", TOUCH)}>
            <ArrowLineDownIcon />
            Jump to latest
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground tabular-nums" aria-live={live ? "off" : "polite"}>
        {needle ? `${rows.length.toLocaleString()} of ${clean.length.toLocaleString()} lines match` : `${clean.length.toLocaleString()} lines`}
        {live ? " · live" : ""}
      </p>
    </div>
  )
}
