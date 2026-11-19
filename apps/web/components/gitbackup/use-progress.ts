"use client"

import { useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"

import { progress } from "@/app/(app)/more/github-backup/actions"
import type { Progress } from "@/lib/gitbackup/runner"

// The job's live run: every 2 s while one is running, every 10 s otherwise. Refreshes the page when a run ends.
export function useProgress(jobId: string) {
  const router = useRouter()
  const [p, setP] = useState<Progress>(null)
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
      setP(now)
      if (was.current && !now) router.refresh()
      was.current = Boolean(now)
      // kick() can start a tick while another is in flight: keep a single timer chain.
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

  // After starting a run: look right away (the run may take a moment to show).
  const kick = useCallback(() => {
    was.current = true
    setTimeout(() => tickRef.current?.(), 600)
  }, [])
  return { progress: p, kick }
}
