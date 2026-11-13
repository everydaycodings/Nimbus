"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"

// Refreshes the page every few seconds while the re-wrap job runs.
export function Poll({ on }: { on: boolean }) {
  const router = useRouter()
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => router.refresh(), 3000)
    return () => clearInterval(t)
  }, [on, router])
  return null
}

// A new key made in this browser; it is never sent anywhere.
export function NewKey() {
  const [key, setKey] = useState<string | null>(null)
  return (
    <div className="grid gap-2">
      <Button
        type="button"
        variant="outline"
        className="w-fit"
        onClick={() => setKey(btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))))}
      >
        Make a new key
      </Button>
      {key && (
        <div className="grid gap-1">
          <code className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-sm break-all select-all">{key}</code>
          <p className="text-xs text-muted-foreground">Made in your browser, not stored here. Keep a copy offline before using it.</p>
        </div>
      )}
    </div>
  )
}
