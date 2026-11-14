"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export const SECTION = "flex flex-col gap-3"
export const LIST = "divide-y overflow-hidden rounded-xl border bg-card"
export const DAY = new Intl.DateTimeFormat("en", { dateStyle: "medium" })
export const WHEN = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" })
export const RADIO =
  "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm has-checked:border-ring/60 has-checked:bg-input/30"
export const SELECT =
  "h-9 min-w-0 rounded-md border border-input bg-input/20 px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
export const CODE =
  "block w-full text-left overflow-x-auto rounded-lg bg-input/20 p-3 font-mono text-xs leading-relaxed whitespace-pre"

export function Heading({
  id,
  title,
  hint,
  children,
}: {
  id: string
  title: string
  hint: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
      <div className="mr-auto grid min-w-0 gap-1">
        <h2 id={id} className="text-base font-semibold">
          {title}
        </h2>
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">{hint}</p>
      </div>
      {children}
    </div>
  )
}

export function Empty({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-12 text-center">
      <Icon className="size-8 text-muted-foreground" />
      <p className="font-medium">{title}</p>
      <div className="flex w-full max-w-lg flex-col items-center gap-3 text-sm text-pretty text-muted-foreground">{children}</div>
    </div>
  )
}

// Confirms inline: the button turns into "Sure? Yes / Keep".
export function Confirm({
  label,
  question,
  yes,
  pending,
  onYes,
}: {
  label: string
  question: string
  yes: string
  pending: boolean
  onYes: () => void
}) {
  const [sure, setSure] = useState(false)
  if (!sure)
    return (
      <Button variant="outline" size="sm" onClick={() => setSure(true)}>
        {label}
      </Button>
    )
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{question}</span>
      <Button variant="destructive" size="sm" disabled={pending} onClick={onYes}>
        {yes}
      </Button>
      <Button variant="ghost" size="sm" autoFocus disabled={pending} onClick={() => setSure(false)}>
        Keep
      </Button>
    </span>
  )
}

// `copy`: leaves room for a Copy button in the corner.
export function Code({ children, copy }: { children: string; copy?: boolean }) {
  return <code className={cn(CODE, copy && "pt-12 sm:pt-3 sm:pr-20")}>{children}</code>
}
