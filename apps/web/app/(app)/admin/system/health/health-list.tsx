"use client"

import { ArrowRightIcon, CaretDownIcon } from "@phosphor-icons/react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState, useSyncExternalStore } from "react"

import { SubmitButton } from "@/components/submit-button"
import { buttonVariants } from "@/components/ui/button"
import type { Range, ServiceHealth } from "@/lib/health"
import { PROBE_TEXT, SERVICE_HREF, ago, type Outcome } from "@/lib/health-rules"
import { cn } from "@/lib/utils"
import { recheckService } from "./actions"

// Picks up the worker's results without a reload.
export function AutoRefresh() {
  const router = useRouter()
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh()
    }, 60_000)
    return () => clearInterval(t)
  }, [router])
  return null
}

const DOT = {
  ok: "bg-success",
  degraded: "bg-warning",
  down: "bg-destructive",
  off: "border border-muted-foreground/50",
}

const BAR: Record<Outcome | "none", string> = {
  ok: "bg-success/70",
  slow: "bg-warning",
  fail: "bg-destructive",
  off: "bg-muted-foreground/20",
  none: "bg-muted",
}

const BAR_TEXT: Record<Outcome | "none", string> = {
  ok: "Working",
  slow: "Slow at least once",
  fail: "Failed at least once",
  off: "Off",
  none: "Not checked",
}

function statusText(x: ServiceHealth) {
  if (x.status === "off") return x.disabled ? "Turned off" : "Not set up"
  if (x.status === "degraded") return x.outcome === "slow" ? "Slow" : "Failing"
  return x.status === "down" ? "Down" : "Working"
}

const TIME: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
}
const at = (ms: number | string) => new Date(ms).toLocaleString(undefined, TIME)

function duration(from: string, to: string) {
  const m = Math.max(
    1,
    Math.round((Date.parse(to) - Date.parse(from)) / 60_000)
  )
  return m < 120 ? `${m} min` : `${Math.round(m / 60)} h`
}

function onHashChange(fn: () => void) {
  addEventListener("hashchange", fn)
  return () => removeEventListener("hashchange", fn)
}

export function HealthList({
  services,
  from,
  to,
  range,
}: {
  services: ServiceHealth[]
  from: number
  to: number
  range: Range
}) {
  // Rows the admin opened or closed; otherwise a link from a notification
  // (#health-email) opens its service.
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  const hash = useSyncExternalStore(
    onHashChange,
    () => location.hash,
    () => ""
  )
  const span = range === "24h" ? "24 hours" : "7 days"
  const isOpen = (s: string) => toggled[s] ?? hash === `#health-${s}`
  const toggle = (s: string) => setToggled((t) => ({ ...t, [s]: !isOpen(s) }))

  return (
    <section aria-label="Services" className="flex flex-col gap-3">
      <div className="hidden grid-cols-[minmax(0,15rem)_minmax(0,1fr)_8.5rem_16rem_1rem] gap-x-5 px-4 text-xs font-medium text-muted-foreground lg:grid">
        <span>Service</span>
        <span>Last result</span>
        <span className="flex justify-end gap-3">
          <span className="w-14 text-right">Latency</span>
          <span className="w-14 text-right">Uptime</span>
        </span>
        <span>Last {span}</span>
      </div>
      <ul className="divide-y rounded-xl border bg-card">
        {services.map((x) => {
          const id = `health-${x.service}`
          const open = isOpen(x.service)
          const size = (to - from) / x.bars.length
          const failures = x.bars.filter((b) => b === "fail").length
          return (
            <li
              key={x.service}
              id={id}
              className="scroll-mt-24 first:rounded-t-xl last:rounded-b-xl"
            >
              <button
                type="button"
                aria-expanded={open}
                aria-controls={`${id}-detail`}
                onClick={() => toggle(x.service)}
                className="grid w-full grid-cols-[minmax(0,1fr)_auto_1rem] items-center gap-x-4 gap-y-3 px-4 py-3.5 text-left transition-colors outline-none [grid-template-areas:'name_meta_caret'_'bars_bars_bars'] hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_8.5rem_16rem_1rem] lg:gap-x-5 lg:[grid-template-areas:'name_detail_meta_bars_caret']"
              >
                <span className="flex min-w-0 items-center gap-2.5 [grid-area:name]">
                  <span
                    aria-hidden
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      DOT[x.status]
                    )}
                  />
                  <span className="truncate text-sm font-medium">
                    {x.label}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 text-xs",
                      x.status === "down"
                        ? "font-medium text-destructive"
                        : x.status === "degraded"
                          ? "text-warning"
                          : "text-muted-foreground"
                    )}
                  >
                    {statusText(x)}
                  </span>
                </span>
                <span className="hidden truncate text-sm text-muted-foreground [grid-area:detail] lg:block">
                  {x.detail ?? "No result yet"}
                </span>
                <span className="flex justify-end gap-3 text-sm tabular-nums [grid-area:meta]">
                  <span className="hidden w-14 text-right sm:inline">
                    {x.latencyMs === null ? (
                      <span className="text-muted-foreground">–</span>
                    ) : (
                      <>
                        {x.latencyMs.toLocaleString()}
                        <span className="text-muted-foreground"> ms</span>
                      </>
                    )}
                  </span>
                  <span className="w-14 text-right">
                    {x.uptime === null ? (
                      <span className="text-muted-foreground">–</span>
                    ) : (
                      `${(Math.floor(x.uptime * 1000) / 10).toLocaleString()}%`
                    )}
                  </span>
                </span>
                <span
                  role="img"
                  aria-label={
                    x.uptime === null
                      ? `Not checked in the last ${span}`
                      : `Last ${span}: ${failures ? `failed in ${failures} of ${x.bars.length} periods` : "no failures"}`
                  }
                  className="flex h-6 gap-px [grid-area:bars]"
                >
                  {x.bars.map((b, i) => (
                    <span
                      key={i}
                      title={`${at(from + i * size)} – ${at(from + (i + 1) * size)} · ${BAR_TEXT[b ?? "none"]}`}
                      suppressHydrationWarning
                      className={cn(
                        "flex-1 rounded-[1.5px] first:rounded-l-sm last:rounded-r-sm",
                        BAR[b ?? "none"]
                      )}
                    />
                  ))}
                </span>
                <CaretDownIcon
                  aria-hidden
                  className={cn(
                    "size-4 text-muted-foreground transition-transform duration-200 [grid-area:caret] motion-reduce:transition-none",
                    open && "rotate-180"
                  )}
                />
              </button>
              {open && (
                <Detail id={`${id}-detail`} x={x} span={span} now={to} />
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function Detail({
  id,
  x,
  span,
  now,
}: {
  id: string
  x: ServiceHealth
  span: string
  now: number
}) {
  const href = SERVICE_HREF[x.service]
  return (
    <div
      id={id}
      className="grid gap-6 border-t border-dashed px-4 pt-4 pb-5 lg:grid-cols-2 lg:pl-[2.125rem]"
    >
      <dl className="grid content-start gap-3 text-sm">
        <div className="grid gap-0.5">
          <dt className="text-xs text-muted-foreground">Last result</dt>
          <dd className="text-pretty">
            {x.detail ?? "Not checked yet."}
            {x.checkedAt && (
              <span className="text-muted-foreground">
                {" "}
                · {ago(x.checkedAt, now)}
              </span>
            )}
          </dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-xs text-muted-foreground">What&apos;s checked</dt>
          <dd className="text-pretty">{PROBE_TEXT[x.service]}</dd>
        </div>
        {x.slowMs && (
          <div className="grid gap-0.5">
            <dt className="text-xs text-muted-foreground">Latency</dt>
            <dd className="tabular-nums">
              {x.latencyMs === null
                ? "–"
                : `${x.latencyMs.toLocaleString()} ms`}
              <span className="text-muted-foreground">
                {" "}
                · slow above {x.slowMs.toLocaleString()} ms
              </span>
            </dd>
          </div>
        )}
      </dl>

      <div className="grid content-start gap-3">
        <h3 className="text-xs text-muted-foreground">
          Failures in the last {span}
        </h3>
        {x.incidents.length ? (
          <ol className="grid gap-2.5 text-sm">
            {x.incidents.map((i) => (
              <li key={i.start} className="grid gap-0.5">
                <span className="flex flex-wrap gap-x-2 tabular-nums">
                  <time dateTime={i.start} suppressHydrationWarning>
                    {at(i.start)}
                  </time>
                  <span
                    className={
                      i.end ? "text-muted-foreground" : "text-destructive"
                    }
                  >
                    {i.end
                      ? `for ${duration(i.start, i.end)}`
                      : "still failing"}
                  </span>
                </span>
                <span className="text-pretty text-muted-foreground">
                  {i.detail}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">None.</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 lg:col-span-2">
        <form action={recheckService.bind(null, x.service)}>
          <SubmitButton variant="outline" size="sm">
            Check again
          </SubmitButton>
        </form>
        {href && (
          <Link
            href={href}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            Settings
            <ArrowRightIcon />
          </Link>
        )}
      </div>
    </div>
  )
}
