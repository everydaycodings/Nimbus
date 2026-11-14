"use client"

import { CheckCircleIcon, WarningCircleIcon } from "@phosphor-icons/react"
import Link from "next/link"
import { useState } from "react"

import { useLoad } from "@/components/secrets/access-view"
import { Empty } from "@/components/secrets/pki-ui"
import { SELECT } from "@/components/secrets/ui"
import { cn } from "@/lib/utils"

type Fix = { label: string; detail: string; view: string; folder?: string; key?: string; tab?: string; href?: string }
type Section = { id: string; title: string; hint: string; items: Fix[]; total: number }
type Report = { score: number; grade: string; oldDays: number; checked: number; sections: Section[] }

const tone = (score: number) => (score >= 90 ? "text-success" : score >= 70 ? "text-warning" : "text-destructive")
const bar = (score: number) => (score >= 90 ? "bg-success" : score >= 70 ? "bg-warning" : "bg-destructive")

// A score and the lists behind it. Computed on the server from the real values; only
// names, places and ages come back. Each line opens where it can be fixed.
export function HealthView({ projectId, onOpen }: { projectId: string; onOpen: (view: string, folder?: string, tab?: string) => void }) {
  const [days, setDays] = useState(180)
  const { data, error } = useLoad<Report>(`/projects/${projectId}/health?oldDays=${days}`)
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Health</h2>
        <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          Old after
          <select aria-label="Treat secrets as old after" className={cn(SELECT, "h-8 w-auto")} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[30, 90, 180, 365].map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </label>
      </div>
      <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
      {!data ? (
        <p className="text-sm text-muted-foreground">Checking…</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border px-5 py-4">
            <p className={cn("text-5xl font-semibold tabular-nums", tone(data.score))} aria-label={`Score ${data.score} out of 100`}>
              {data.score}
            </p>
            <div className="grid min-w-0 flex-1 basis-56 gap-2">
              <p className="font-medium">{data.grade}</p>
              <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                <div className={cn("h-full rounded-full", bar(data.score))} style={{ width: `${data.score}%` }} />
              </div>
              <p className="text-xs text-muted-foreground">
                Looked at {data.checked} secret{data.checked === 1 ? "" : "s"} you can see. Values are checked on the server and never shown here.
              </p>
            </div>
          </div>
          {data.sections.every((s) => s.total === 0) && (
            <Empty icon={<CheckCircleIcon />} title="Nothing to fix">
              No weak, reused or stale secrets, no drift and nothing expiring.
            </Empty>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            {data.sections
              .filter((s) => s.total > 0)
              .map((s) => (
                <section key={s.id} aria-label={s.title} className="flex min-w-0 flex-col gap-2 rounded-xl border p-4">
                  <div className="flex items-center gap-2">
                    <WarningCircleIcon className="size-4 shrink-0 text-warning" />
                    <h3 className="text-sm font-semibold">{s.title}</h3>
                    <span className="ml-auto rounded-full bg-muted px-2 text-xs tabular-nums">{s.total}</span>
                  </div>
                  <p className="text-xs text-pretty text-muted-foreground">{s.hint}</p>
                  <ul className="divide-y">
                    {s.items.map((f, i) => {
                      const body = (
                        <>
                          <span className="w-full min-w-0 truncate font-mono text-sm" title={f.label}>{f.label}</span>
                          <span className="min-w-0 text-xs text-pretty text-muted-foreground">{f.detail}</span>
                        </>
                      )
                      const cls = "-mx-2 flex w-[calc(100%+1rem)] min-w-0 flex-col items-start gap-0.5 rounded-md px-2 py-2 text-left outline-none hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      return (
                        <li key={i}>
                          {f.href ? (
                            <Link href={f.href} className={cls}>{body}</Link>
                          ) : (
                            <button className={cls} onClick={() => onOpen(f.view, f.folder, f.tab)}>{body}</button>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                  {s.total > s.items.length && <p className="text-xs text-muted-foreground">and {s.total - s.items.length} more</p>}
                </section>
              ))}
          </div>
        </>
      )}
    </div>
  )
}
