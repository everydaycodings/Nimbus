import { HardDrivesIcon } from "@phosphor-icons/react/dist/ssr"

import { formatBytes } from "@/lib/file-rules"
import type { Usage } from "@/lib/quota"
import { cn } from "@/lib/utils"

// Hues match the file-type icons, so the bar reads like the tiles. Older
// versions and trash are hatched: stored, but not something you see in My files.
const PARTS = [
  { key: "images", label: "Images", fill: "bg-file-image" },
  { key: "videos", label: "Videos", fill: "bg-file-video" },
  { key: "docs", label: "Docs", fill: "bg-file-doc" },
  { key: "other", label: "Other", fill: "bg-file-archive" },
  { key: "vault", label: "Vault", fill: "bg-foreground/70" },
  {
    key: "extra",
    label: "Versions & trash",
    fill: "bg-[repeating-linear-gradient(-45deg,var(--muted-foreground)_0_2px,transparent_2px_4px)]",
  },
] as const

// Sidebar footer meter: used of the quota, split by kind of file. Hidden while
// the sidebar is collapsed.
export function StorageMeter({ usage }: { usage: Usage }) {
  const { used, quota } = usage
  const scale = quota ?? used
  const full = quota !== null && used >= quota
  const near = quota !== null && used >= quota * 0.9
  const parts = PARTS.filter((p) => usage[p.key] > 0)
  const summary =
    quota === null
      ? `${formatBytes(used)} used`
      : `${formatBytes(used)} of ${formatBytes(quota)}`

  return (
    <div className="flex flex-col gap-2 px-2 pb-1 group-data-[collapsed=true]/sidebar:hidden">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-1.5 font-medium text-sidebar-foreground/70">
          <HardDrivesIcon className="size-4" />
          Storage
        </span>
        <span
          className={cn(
            "whitespace-nowrap tabular-nums",
            near ? "text-destructive" : "text-sidebar-foreground/70"
          )}
        >
          {quota === null
            ? `${formatBytes(used)} used`
            : `${formatBytes(used)} / ${formatBytes(quota)}`}
        </span>
      </div>
      <div
        role={quota === null ? undefined : "meter"}
        aria-label={quota === null ? undefined : "Storage used"}
        aria-hidden={quota === null || undefined}
        aria-valuemin={quota === null ? undefined : 0}
        aria-valuemax={quota ?? undefined}
        aria-valuenow={quota === null ? undefined : Math.min(used, quota)}
        aria-valuetext={quota === null ? undefined : summary}
        className="flex h-1.5 gap-px overflow-hidden rounded-full bg-sidebar-accent"
      >
        {scale > 0 &&
          parts.map((p) => (
            <span
              key={p.key}
              className={cn("h-full min-w-0.5", p.fill)}
              style={{ width: `${(usage[p.key] / scale) * 100}%` }}
            />
          ))}
      </div>
      {parts.length > 0 && (
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-sidebar-foreground/70">
          {parts.map((p) => (
            <li
              key={p.key}
              title={formatBytes(usage[p.key])}
              className="flex items-center gap-1.5"
            >
              <span
                aria-hidden
                className={cn("size-2 shrink-0 rounded-full", p.fill)}
              />
              {p.label}
              <span className="sr-only">: {formatBytes(usage[p.key])}</span>
            </li>
          ))}
        </ul>
      )}
      {full && (
        <p className="text-xs text-destructive">
          Full. Empty the trash to upload more.
        </p>
      )}
    </div>
  )
}
