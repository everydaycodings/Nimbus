"use client"

import { useEffect, useState } from "react"

import { buildOutlook } from "@/app/(app)/registry/build-actions"
import type { Outlook } from "@/lib/registry/builds"

// What a build would meet right now. Asked of the server when a dialog opens, so the load is current.
export function useOutlook(on: boolean) {
  const [o, setO] = useState<Outlook | null>(null)
  useEffect(() => {
    if (!on) return
    let live = true
    buildOutlook().then((r) => live && setO(r), () => {})
    return () => {
      live = false
    }
  }, [on])
  return o
}

const size = (m: string) => m.replace(/g$/i, " GB").replace(/m$/i, " MB")

// The quiet safety line: the caps every build runs under and how busy the server is.
export function SafetyLine({ o }: { o: Outlook | null }) {
  if (!o) return null
  return (
    <p className="text-xs text-pretty text-muted-foreground">
      Builds use up to {size(o.mem)} and {o.cpus} {o.cpus === "1" ? "CPU" : "CPUs"}, stop after {o.timeoutMin} min. Server now: {o.memPct}% memory used.
    </p>
  )
}
