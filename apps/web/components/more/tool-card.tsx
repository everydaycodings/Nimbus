import Link from "next/link"

import type { MORE_TOOLS } from "@/lib/more-tools"
import { ago } from "@/lib/health-rules"

export type ToolStatus = { jobs: number; repos: number; lastRunAt: string | null; failed: boolean }

export function ToolCard({ tool, status, now }: { tool: (typeof MORE_TOOLS)[number]; status: ToolStatus; now: number }) {
  const Icon = tool.icon
  return (
    <Link
      href={tool.href}
      className="group flex flex-col gap-4 rounded-xl border border-border bg-transparent p-4 outline-none transition-colors hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <span className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
          <Icon className="size-5" />
        </span>
        <span className="min-w-0 grid gap-0.5">
          <span className="truncate font-medium" title={tool.name}>{tool.name}</span>
          <span className="line-clamp-2 text-sm text-pretty text-muted-foreground" title={tool.text}>{tool.text}</span>
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground tabular-nums">
        {status.jobs === 0 ? (
          "Not set up"
        ) : (
          <>
            <span>
              {status.lastRunAt ? `Last backup ${ago(status.lastRunAt, now)}` : "No backup yet"} ·{" "}
              {status.repos === 1 ? "1 repo" : `${status.repos} repos`}
            </span>
            {status.failed && (
              <span className="flex items-center gap-1.5 text-foreground">
                <span aria-hidden className="size-2 rounded-full bg-destructive" />
                Last run failed
              </span>
            )}
          </>
        )}
      </span>
    </Link>
  )
}
