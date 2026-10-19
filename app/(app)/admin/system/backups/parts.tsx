import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr"
import Link from "next/link"

import type { RunStatus } from "@/lib/backup-rules"
import type { backupStatus } from "@/lib/backup/status"
import { cn } from "@/lib/utils"

export const BASE = "/admin/system/backups"

const TABS = [
  { href: BASE, label: "Overview" },
  { href: `${BASE}/history`, label: "History" },
  { href: `${BASE}/settings`, label: "Settings" },
]

export function Tabs({ current }: { current: string }) {
  return (
    <nav aria-label="Backups" className="-mt-4 flex gap-1 border-b">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.href === current ? "page" : undefined}
          className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-[current=page]:border-foreground aria-[current=page]:text-foreground"
        >
          {t.label}
        </Link>
      ))}
    </nav>
  )
}

const CODE = "rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground"

export function Callout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div role="status" className="flex gap-3 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm">
      <WarningCircleIcon weight="fill" className="mt-0.5 size-4 shrink-0 text-warning" />
      <p className="text-pretty">
        <span className="font-medium">{title}</span>{" "}
        <span className="text-muted-foreground">{children}</span>
      </p>
    </div>
  )
}

// What stands between this Nimbus and working backups, most basic first.
export function SetupNotes({ b }: { b: Awaited<ReturnType<typeof backupStatus>> }) {
  const on = b.kinds.some((k) => k.schedule.enabled)
  return (
    <>
      {b.error && <Callout title="Backup storage can't be used.">{b.error}</Callout>}
      {!b.dest && !b.error && (
        <Callout title="No backup storage yet.">
          Add a bucket under{" "}
          <Link href={`${BASE}/settings#backup-storage`} className="text-foreground underline underline-offset-4">
            Settings
          </Link>
          . Any S3-compatible service works: Amazon S3, Cloudflare R2, Backblaze B2, Wasabi, MinIO. Use a different
          one from where Nimbus keeps its files, so one outage can&apos;t take both.
        </Callout>
      )}
      {!b.worker && (
        <Callout title={on ? "Scheduled backups aren't running." : "The backup worker isn't running."}>
          Start it with <code className={CODE}>npm run worker:backup</code> on a machine with Docker, next to the
          app. It dumps the database, checks the dump in a throwaway Postgres, and copies files. It can&apos;t run on
          Vercel.
        </Callout>
      )}
      {b.worker && !b.worker.docker && (
        <Callout title="The backup worker can't reach Docker.">
          Database backups need it for <code className={CODE}>pg_dump</code> and the throwaway Postgres that checks
          each dump. Install Docker, or give the worker&apos;s user access to it, then restart the worker.
        </Callout>
      )}
      {b.worker && !b.worker.key && (
        <Callout title="BACKUP_ENCRYPTION_KEY isn't set for the worker.">
          Generate one with <code className={CODE}>openssl rand -base64 32</code>, add it to the worker&apos;s
          environment and restart it. Keep a copy somewhere safe and offline: without it, no backup can be restored.
        </Callout>
      )}
    </>
  )
}

export const STATUS: Record<RunStatus, { label: string; dot: string }> = {
  running: { label: "Running", dot: "bg-brand animate-pulse motion-reduce:animate-none" },
  ok: { label: "Verified", dot: "bg-success" },
  warning: { label: "Warning", dot: "bg-warning" },
  failed: { label: "Failed", dot: "bg-destructive" },
  skipped: { label: "Skipped", dot: "border border-muted-foreground/50" },
}

export function StatusLabel({ status, className }: { status: RunStatus; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-sm whitespace-nowrap", className)}>
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", STATUS[status].dot)} />
      {STATUS[status].label}
    </span>
  )
}

export function duration(from: Date, to: Date | null) {
  if (!to) return null
  const s = Math.round((to.getTime() - from.getTime()) / 1000)
  if (s < 60) return `${s} s`
  if (s < 3600) return `${Math.floor(s / 60)} min ${s % 60} s`
  return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`
}

export const when = (d: Date, tz?: string) =>
  d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz,
    timeZoneName: tz ? "short" : undefined,
  })

// "in 3 h", "in 12 min"
export function until(d: Date, now: number) {
  const m = Math.max(1, Math.round((d.getTime() - now) / 60_000))
  return m < 60 ? `in ${m} min` : m < 48 * 60 ? `in ${Math.round(m / 60)} h` : `in ${Math.round(m / 1440)} days`
}
