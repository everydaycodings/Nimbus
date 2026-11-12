"use client"

import { useEffect, useRef } from "react"

import { MiniPlayer } from "@/components/audio-player"
import { CastRemote } from "@/components/cast-remote"
import { makeStore, useStore } from "@/lib/media-extras"
import { cn } from "@/lib/utils"

// How many docks sit inside an open previewer.
const inside = makeStore({ n: 0 })

// Floats above the app: the Cast remote while a TV is connected, and the mini-player
// while audio plays. The app layout mounts one; an open previewer is a modal that makes
// everything outside it inert, so it mounts its own (`within`) and the layout's steps aside.
export function PlaybackDock({ within = false }: { within?: boolean }) {
  const { n } = useStore(inside)
  useEffect(() => {
    if (!within) return
    inside.set({ n: inside.get().n + 1 })
    return () => inside.set({ n: inside.get().n - 1 })
  }, [within])
  const box = useRef<HTMLDivElement>(null)
  const hidden = !within && n > 0
  // Tells the page how much room the dock takes (--dock-h), so it can leave it free.
  useEffect(() => {
    const el = box.current
    if (within || !el) return
    const set = () =>
      document.documentElement.style.setProperty("--dock-h", el.offsetHeight ? `${el.offsetHeight + 24}px` : "0px")
    const ro = new ResizeObserver(set)
    ro.observe(el)
    set()
    return () => {
      ro.disconnect()
      document.documentElement.style.removeProperty("--dock-h")
    }
  }, [within, hidden])
  if (hidden) return null
  return (
    <div
      ref={box}
      className={cn(
        "pointer-events-none fixed inset-x-3 bottom-3 z-[70] mx-auto flex max-w-xl flex-col gap-2",
        // Beside the sidebar, not over its storage meter and account.
        !within && "md:left-[17rem]"
      )}
    >
      <CastRemote />
      <MiniPlayer />
    </div>
  )
}
