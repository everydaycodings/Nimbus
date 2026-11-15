"use client"

import { ArrowClockwiseIcon } from "@phosphor-icons/react"
import { useCallback, useEffect, useState, useTransition } from "react"

import { refreshAdvice, tagAdvice } from "@/app/(app)/registry/actions"
import { SeverityCounts, type Counts } from "@/components/registry-scan"
import { TOUCH, WHEN } from "@/components/registry-ui"
import { useNotice } from "@/components/toaster"
import { Button } from "@/components/ui/button"
import { sizeOf } from "@/lib/registry/size"

export type AdviceData = {
  base: {
    name: string
    tag: string
    source: "annotation" | "dockerfile" | "history" | null
  } | null
  current?: Counts
  suggestions: {
    tag: string
    reason: string
    counts?: Counts
    sizeDelta?: number
  }[]
  checkedAt: Date | string | null
  status: "ready" | "pending" | "unavailable"
  note?: string
}

const SOURCE = {
  annotation: "from the image's base-name label",
  dockerfile: "from the Dockerfile's FROM line",
  history: "guessed from the image history",
} as const

const signed = (n: number) => `${n > 0 ? "+" : "−"}${sizeOf(Math.abs(n))}`

// "Critical 2 → 0" for each severity that changes.
export function Delta({ from, to }: { from: Counts; to: Counts }) {
  const parts = (["critical", "high", "medium", "low"] as const).filter(
    (s) => from[s] !== to[s]
  )
  if (!parts.length)
    return (
      <span className="text-muted-foreground">Same vulnerability counts</span>
    )
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-0.5 tabular-nums">
      {parts.map((s) => (
        <span key={s}>
          <span className="capitalize">{s}</span> {from[s]} → {to[s]}
        </span>
      ))}
    </span>
  )
}

export function BaseImageView({
  name,
  tag,
  canRefresh,
}: {
  name: string
  tag: string
  canRefresh: boolean
}) {
  const setNotice = useNotice()
  const [a, setA] = useState<AdviceData | null | "loading">("loading")
  const [pending, start] = useTransition()
  const load = useCallback(
    () =>
      tagAdvice(name, tag)
        .then((x) => setA(x as AdviceData | null))
        .catch(() => setA(null)),
    [name, tag]
  )
  useEffect(() => {
    setA("loading")
    load()
  }, [load])
  const checking = a !== "loading" && a?.status === "pending"
  // The check runs in the worker; look again while it does.
  useEffect(() => {
    if (!checking) return
    const t = setInterval(load, 4000)
    return () => clearInterval(t)
  }, [checking, load])

  if (a === "loading")
    return (
      <p className="py-4 text-sm text-muted-foreground">
        Reading the base image…
      </p>
    )
  if (!a)
    return (
      <p className="text-sm text-muted-foreground">
        Couldn&apos;t load base image advice.
      </p>
    )
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="mr-auto grid min-w-0 gap-0.5">
          <p className="text-sm">
            {a.base ? (
              <>
                Base image{" "}
                <span className="font-mono break-all">
                  {a.base.name}:{a.base.tag}
                </span>
              </>
            ) : checking ? (
              "Looking for the base image"
            ) : (
              "Base image unknown"
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {a.base?.source
              ? `Detected ${SOURCE[a.base.source]}.`
              : "Add the org.opencontainers.image.base.name label so Nimbus can find it."}
            {a.checkedAt && a.status === "ready" && (
              <span suppressHydrationWarning>
                {" "}
                Checked {WHEN.format(new Date(a.checkedAt))}.
              </span>
            )}
          </p>
        </div>
        {canRefresh && a.base && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={TOUCH}
            disabled={pending || checking}
            onClick={() =>
              start(async () => {
                const r = await refreshAdvice(name, tag)
                if (r.error) setNotice({ text: r.error, error: true })
                else {
                  setA({ ...a, status: "pending" })
                  load()
                }
              })
            }
          >
            <ArrowClockwiseIcon />
            Refresh
          </Button>
        )}
      </div>
      {a.current && (
        <p className="text-xs text-muted-foreground">
          This image:{" "}
          <SeverityCounts c={a.current} className="ml-1 text-foreground" />
        </p>
      )}
      {a.status === "pending" ? (
        <p role="status" className="text-sm text-muted-foreground">
          Checking newer base images… this updates when it&apos;s done.
        </p>
      ) : a.status === "unavailable" ? (
        <p className="rounded-md border border-dashed px-3 py-2 text-sm text-pretty text-muted-foreground">
          {a.note ?? "Advice isn't available for this image right now."}
        </p>
      ) : a.suggestions.length === 0 ? (
        <p className="text-sm text-pretty text-muted-foreground">
          {a.note ?? "No better base image found. You're on a current one."}
        </p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-md border text-xs">
          {a.suggestions.map((s) => (
            <li key={s.tag} className="grid gap-1 px-3 py-2.5">
              <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-mono text-sm font-medium break-all">
                  {a.base?.name}:{s.tag}
                </span>
                {s.sizeDelta !== undefined && s.sizeDelta !== 0 && (
                  <span className="text-muted-foreground tabular-nums">
                    {signed(s.sizeDelta)} size
                  </span>
                )}
              </p>
              <p className="text-pretty text-muted-foreground">{s.reason}</p>
              {s.counts && a.current && (
                <Delta from={a.current} to={s.counts} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
