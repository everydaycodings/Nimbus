"use client"

// Small shared pieces for the Certificates and Items views.
import { useState } from "react"

import { cn } from "@/lib/utils"

export const stamp = new Intl.DateTimeFormat("en", { dateStyle: "medium" })
export const TEXTAREA =
  "w-full rounded-md border border-input bg-transparent p-3 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"

export const daysLeft = (iso: string) => Math.floor((new Date(iso).getTime() - Date.now()) / 86_400_000)

// "12 days left", red inside a week, amber inside a month.
export function Expiry({ at, revoked }: { at: string; revoked?: boolean }) {
  const d = daysLeft(at)
  if (revoked) return <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive">Revoked</span>
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-xs whitespace-nowrap tabular-nums",
        d < 0 || d <= 7 ? "bg-destructive/10 text-destructive" : d <= 30 ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground"
      )}
      title={stamp.format(new Date(at))}
    >
      {d < 0 ? `Expired ${-d}d ago` : d === 0 ? "Expires today" : `${d} day${d === 1 ? "" : "s"} left`}
    </span>
  )
}

export function Tabs<T extends string>({ label, tabs, value, onChange }: { label: string; tabs: readonly (readonly [T, string])[]; value: T; onChange: (t: T) => void }) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b">
      {tabs.map(([id, text]) => (
        <button
          key={id}
          role="tab"
          aria-selected={value === id}
          onClick={() => onChange(id)}
          className={cn(
            "-mb-px h-9 shrink-0 border-b-2 px-3 text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
            value === id ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

export function Empty({ icon, title, children }: { icon: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center [&>svg]:size-6 [&>svg]:text-muted-foreground">
      {icon}
      <p className="font-medium">{title}</p>
      {children && <p className="max-w-prose text-sm text-pretty text-muted-foreground">{children}</p>}
    </div>
  )
}

// A label/value line for the detail panels.
export function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-xs text-muted-foreground sm:pt-0.5">{k}</dt>
      <dd className="min-w-0 text-sm break-words">{children}</dd>
    </div>
  )
}

// Reads files as base64, in the order picked.
export async function readB64(files: FileList | File[]) {
  return Promise.all(
    [...files].map(
      (f) =>
        new Promise<string>((ok, no) => {
          const r = new FileReader()
          r.onload = () => ok(String(r.result).split(",")[1] ?? "")
          r.onerror = () => no(r.error)
          r.readAsDataURL(f)
        })
    )
  )
}

export function useBusy() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return { busy, error, setError, setBusy }
}
