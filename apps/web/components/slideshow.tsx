"use client"

import {
  CaretLeftIcon,
  CaretRightIcon,
  PauseIcon,
  PlayIcon,
  XIcon,
} from "@phosphor-icons/react"
import { useCallback, useEffect, useRef, useState } from "react"

import { previewUrl } from "@/app/(app)/upload-actions"
import { CastButton } from "@/components/player-controls"
import { Button } from "@/components/ui/button"
import { castPhoto, useCastButton, useCastFollow } from "@/lib/cast"
import type { Item } from "@/lib/files"
import { cn } from "@/lib/utils"

// A photo, or a title card ("3 years ago") between groups of photos.
export type Slide =
  | { id: string; item: Item; title?: undefined }
  | { id: string; title: string; sub?: string; item?: undefined }

const PHOTO_MS = 5000
const TITLE_MS = 2500
const label = (s: Slide) => (s.item ? s.item.name : s.title)

// Full-screen slideshow: crossfade, pause (Space), arrows, Esc. `actions` puts the
// current slide's own buttons (e.g. a hide menu) in the top bar.
export function Slideshow({
  slides,
  start = 0,
  onClose,
  actions,
}: {
  slides: Slide[]
  start?: number
  onClose: () => void
  actions?: (slide: Slide) => React.ReactNode
}) {
  const [at, setAt] = useState(Math.min(start, Math.max(slides.length - 1, 0)))
  const [wanted, setPlaying] = useState(true)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [bars, setBars] = useState(true)
  const root = useRef<HTMLDivElement>(null)
  const idle = useRef<ReturnType<typeof setTimeout>>(undefined)
  const last = slides.length - 1
  // Hiding a slide from the list can leave the position past the end.
  const i = Math.min(at, Math.max(last, 0))
  const cur = slides[i]
  // The last slide ends the show.
  const playing = wanted && i < last

  const go = useCallback(
    (by: number) => setAt((n) => Math.min(Math.max(n + by, 0), last)),
    [last]
  )

  // The shown photo and its neighbours are fetched; the neighbours stay mounted so a
  // change fades between them.
  useEffect(() => {
    for (const s of slides.slice(Math.max(i - 1, 0), i + 3)) {
      if (!s.item || urls[s.id]) continue
      previewUrl(s.item.id, null).then((u) => u && setUrls((m) => ({ ...m, [s.id]: u })), () => {})
    }
  }, [slides, i, urls])

  // A TV shows the same photos; the interval above drives it.
  useCastFollow(cur?.item)
  const canCast = useCastButton()

  // Stops at the last slide.
  useEffect(() => {
    if (!playing || !cur) return
    const t = setTimeout(() => go(1), cur.item ? PHOTO_MS : TITLE_MS)
    return () => clearTimeout(t)
  }, [playing, cur, i, last, go])

  // Keys on the window, since focus may be on a button or the page behind.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    root.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if (e.key === "Escape") onClose()
      else if (e.key === "ArrowRight") go(1)
      else if (e.key === "ArrowLeft") go(-1)
      else if (e.key === " " && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault()
        setPlaying((p) => !p)
      } else return
      e.stopPropagation()
    }
    window.addEventListener("keydown", onKey, true)
    return () => {
      window.removeEventListener("keydown", onKey, true)
      prev?.focus?.()
    }
  }, [go, onClose])

  function wake() {
    setBars(true)
    clearTimeout(idle.current)
    idle.current = setTimeout(() => setBars(false), 3000)
  }
  useEffect(() => {
    idle.current = setTimeout(() => setBars(false), 3000)
    return () => clearTimeout(idle.current)
  }, [])

  if (!cur) return null
  const bar = cn(
    "absolute inset-x-0 z-10 flex items-center gap-2 px-3 text-white transition-opacity duration-300 focus-within:opacity-100",
    !bars && "opacity-0"
  )
  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label="Slideshow"
      tabIndex={-1}
      onPointerMove={wake}
      onClick={wake}
      className="fixed inset-0 z-[60] bg-black outline-none"
    >
      {slides.slice(Math.max(i - 1, 0), i + 2).map((s) => (
        <div
          key={s.id}
          aria-hidden={s.id !== cur.id}
          className={cn(
            "absolute inset-0 grid place-items-center transition-opacity duration-700 motion-reduce:duration-0",
            s.id === cur.id ? "opacity-100" : "opacity-0"
          )}
        >
          {s.item ? (
            urls[s.id] && (
              // eslint-disable-next-line @next/next/no-img-element -- private signed URL
              <img src={urls[s.id]} alt={s.item.name} className="max-h-full max-w-full object-contain" />
            )
          ) : (
            <div className="px-6 text-center text-white">
              <p className="text-4xl font-semibold tracking-tight sm:text-6xl">{s.title}</p>
              {s.sub && <p className="mt-3 text-lg text-white/70">{s.sub}</p>}
            </div>
          )}
        </div>
      ))}

      <div className={cn(bar, "top-0 h-14 bg-gradient-to-b from-black/70 to-transparent")}>
        <p className="min-w-0 flex-1 truncate text-sm">{label(cur)}</p>
        {actions?.(cur)}
        {canCast && cur.item && (
          <CastButton
            className="grid size-9 place-items-center rounded-md text-white outline-none hover:bg-white/15 focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_svg]:size-5"
            onClick={() => castPhoto(cur.item!)}
          />
        )}
        <Button variant="ghost" size="icon" aria-label="Close slideshow" onClick={onClose} className="text-white hover:bg-white/15 hover:text-white">
          <XIcon />
        </Button>
      </div>

      <div className={cn(bar, "bottom-0 h-16 justify-center bg-gradient-to-t from-black/70 to-transparent")}>
        <Button variant="ghost" size="icon" aria-label="Previous" disabled={i === 0} onClick={() => go(-1)} className="text-white hover:bg-white/15 hover:text-white">
          <CaretLeftIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={playing ? "Pause" : "Play"}
          onClick={() => {
            // Playing again from the end starts over.
            if (i >= last) setAt(0)
            setPlaying(!playing || i >= last)
          }}
          className="text-white hover:bg-white/15 hover:text-white"
        >
          {playing ? <PauseIcon weight="fill" /> : <PlayIcon weight="fill" />}
        </Button>
        <Button variant="ghost" size="icon" aria-label="Next" disabled={i >= last} onClick={() => go(1)} className="text-white hover:bg-white/15 hover:text-white">
          <CaretRightIcon />
        </Button>
        <span className="ml-2 text-xs text-white/70 tabular-nums">
          {i + 1} / {slides.length}
        </span>
      </div>
      <p aria-live="polite" className="sr-only">
        {label(cur)}
      </p>
    </div>
  )
}
