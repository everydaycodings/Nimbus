"use client"

import { useEffect, useState } from "react"

import { queue } from "@/app/(app)/more/convert/actions"
import type { JobView, Quota } from "@/lib/convert/jobs"

type State = { jobs: JobView[]; quota: Quota }

// The queue, live: every 2 s while something is waiting or running, every 15 s otherwise. `refresh` looks right away (after starting jobs).
export function useQueue(initial: State) {
  const [state, setState] = useState(initial)
  const [stale, setStale] = useState(false)
  const [nudge, setNudge] = useState(0)
  const active = state.jobs.some((j) => j.status === "queued" || j.status === "running")

  useEffect(() => {
    let live = true
    const timer = setTimeout(async () => {
      const r = await queue().catch(() => null)
      if (!live) return
      if (r) setState(r)
      setStale(!r)
      setNudge((n) => n + 1)
    }, active ? 2000 : 15_000)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [active, nudge])

  return { ...state, stale, refresh: () => setTimeout(() => setNudge((n) => n + 1), 400) }
}
