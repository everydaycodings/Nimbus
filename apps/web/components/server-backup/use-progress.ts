"use client"

import { useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"

import { progress } from "@/app/(app)/more/server-backup/actions"
import type { RunView } from "@/lib/server-backup/jobs"

// The job's live run: every 2 s while one is running, every 10 s otherwise. Refreshes the page when a run ends.
export function useProgress(jobId: string) {
  const router = useRouter()
  const [run, setRun] = useState<RunView | null>(null)
  const was = useRef(false)
  const tickRef = useRef<() => void>(undefined)

  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    was.current = false
    const tick = async () => {
      clearTimeout(timer)
      const r = await progress(jobId).catch(() => null)
      if (!live) return
      const now = r && !("error" in r) ? r : null
      setRun(now)
      if (was.current && !now) router.refresh()
      was.current = Boolean(now)
      clearTimeout(timer)
      timer = setTimeout(tick, now ? 2000 : 10_000)
    }
    tickRef.current = tick
    tick()
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [jobId, router])

  // After starting a run: look right away (the row may take a moment to show).
  const kick = useCallback(() => {
    was.current = true
    setTimeout(() => tickRef.current?.(), 600)
  }, [])
  return { run, kick }
}
