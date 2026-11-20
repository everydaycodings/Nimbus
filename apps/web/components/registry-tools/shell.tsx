"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect } from "react"

import type { MirrorView, RuleView, RunView } from "@/lib/registry/tools"
import { TABS, type Tab } from "./format"
import { History } from "./history"
import { Mirrors } from "./mirrors"
import { Rules } from "./rules"

const BASE = "/more/registry-tools"

export function Shell({ tab, rules, mirrors, runs, repos }: { tab: Tab; rules: RuleView[]; mirrors: MirrorView[]; runs: RunView[]; repos: { id: string; name: string }[] }) {
  const router = useRouter()
  // A run in progress finishes in the app or the worker, so the page asks again until nothing is running.
  const busy = rules.some((r) => r.running) || mirrors.some((m) => m.running) || runs.some((r) => r.status === "running")
  useEffect(() => {
    if (!busy) return
    const t = setInterval(() => router.refresh(), 3000)
    return () => clearInterval(t)
  }, [busy, router])
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Registry tools</h1>
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">
          Trim old tags and untagged images from your repos on a schedule, and keep copies of images from Docker Hub, GHCR, Quay or any registry. Removed images wait 7 days in Trash.
        </p>
      </header>
      <nav role="tablist" aria-label="Registry tools sections" className="flex w-fit max-w-full overflow-x-auto rounded-lg bg-muted p-[3px]">
        {TABS.map(([t, text]) => (
          <Link
            key={t}
            href={t === "rules" ? BASE : `${BASE}?tab=${t}`}
            role="tab"
            aria-selected={tab === t}
            aria-current={tab === t ? "page" : undefined}
            className="flex h-7 items-center rounded-md border border-transparent px-3 text-sm whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:h-11 aria-[current=page]:border-input aria-[current=page]:bg-input/30 aria-[current=page]:text-foreground"
          >
            {text}
          </Link>
        ))}
      </nav>
      {tab === "rules" && <Rules rules={rules} repos={repos} />}
      {tab === "mirrors" && <Mirrors mirrors={mirrors} repos={repos} />}
      {tab === "history" && <History runs={runs} />}
    </div>
  )
}
