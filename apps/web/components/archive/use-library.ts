"use client"

import { useEffect, useState } from "react"

import { library } from "@/app/(app)/more/archive/actions"
import type { PageView } from "@/lib/archive/run"

// The saved pages, live: every 2.5 s while one is being captured, every 30 s otherwise. `refresh` looks right away.
export function useLibrary(initial: PageView[]) {
  const [pages, setPages] = useState(initial)
  const [stale, setStale] = useState(false)
  const [nudge, setNudge] = useState(0)
  const active = pages.some((p) => p.status === "running")

  useEffect(() => {
    let live = true
    const timer = setTimeout(async () => {
      const r = await library().catch(() => null)
      if (!live) return
      if (r) setPages(r)
      setStale(!r)
      setNudge((n) => n + 1)
    }, active ? 2500 : 30_000)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [active, nudge])

  return { pages, stale, refresh: () => setTimeout(() => setNudge((n) => n + 1), 600) }
}
