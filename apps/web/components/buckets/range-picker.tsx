"use client"

import { useRouter } from "next/navigation"
import { useTransition } from "react"

import { RANGES } from "@/components/buckets/chart"
import { Segmented } from "@/components/registry-ui"
import type { Range } from "@/lib/s3api/stats"

// The range lives in ?range= so a view can be linked to; the page re-renders on the server.
export function RangePicker({ base, range }: { base: string; range: Range }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <Segmented
      label="Time range"
      value={range}
      options={RANGES}
      disabled={pending}
      onChange={(r) => start(() => router.replace(`${base}${base.includes("?") ? "&" : "?"}range=${r}`, { scroll: false }))}
    />
  )
}
