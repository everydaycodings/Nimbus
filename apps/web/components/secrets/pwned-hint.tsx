"use client"

import { ShieldWarningIcon } from "@phosphor-icons/react"
import { useEffect, useState } from "react"

import { api } from "@/components/secrets/client"
import { matchRange } from "@/lib/secrets/pwned-rules"

// Warns when a password is in a known breach. The browser hashes it (SHA-1) and asks this
// server for the one five-character prefix; the answer is compared here, so the password
// itself never goes anywhere. Quiet when the check is off or can't run.
export function PwnedHint({ value }: { value: string }) {
  const [answer, setAnswer] = useState<{ value: string; res: { n: number } | "unavailable" | null } | null>(null)
  useEffect(() => {
    if (value.length < 4 || !globalThis.crypto?.subtle) return
    let live = true
    const t = setTimeout(async () => {
      try {
        const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(value))
        const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase()
        const r = await api<{ ok: boolean; disabled?: boolean; range?: string }>(`/pwned?prefix=${hex.slice(0, 5)}`)
        if (!live) return
        setAnswer({ value, res: !r.ok ? (r.disabled ? null : "unavailable") : { n: matchRange(r.range ?? "", hex.slice(5)) } })
      } catch {
        if (live) setAnswer({ value, res: "unavailable" })
      }
    }, 700)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [value])
  // An answer for an older value isn't shown.
  const state = answer?.value === value ? answer.res : null
  if (!state) return null
  if (state === "unavailable") return <p className="mt-1 text-xs text-muted-foreground">Couldn&apos;t check this against known breaches right now.</p>
  if (!state.n) return null
  return (
    <p role="status" className="mt-1 flex items-start gap-1.5 text-xs text-pretty text-warning">
      <ShieldWarningIcon className="mt-px size-3.5 shrink-0" />
      This password appears in {state.n.toLocaleString("en")} known data breach{state.n === 1 ? "" : "es"}. Choose another.
    </p>
  )
}
