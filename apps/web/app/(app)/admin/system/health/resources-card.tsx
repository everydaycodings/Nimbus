import { FRAME } from "@/components/admin/setting"
import { formatBytes } from "@/lib/file-rules"
import { hostMetrics } from "@/lib/host-metrics"
import { getSettings } from "@/lib/signup"
import { cn } from "@/lib/utils"

const GB = 1024 ** 3
type Level = "ok" | "warn" | "bad"
const FILL: Record<Level, string> = { ok: "bg-success/70", warn: "bg-warning", bad: "bg-destructive" }
const WORD: Record<Level, string> = { ok: "Fine", warn: "Busy", bad: "Critical" }
// Disk fills up rather than getting busy.
const DISK_WORD: Record<Level, string> = { ok: "Fine", warn: "Low", bad: "Critical" }

// `marks` are where image builds start to wait and where they are stopped, as percent along the bar.
function Meter({ label, pct, level, words = WORD, marks, children }: { label: string; pct: number; level: Level; words?: Record<Level, string>; marks?: [number, string][]; children: React.ReactNode }) {
  const p = Math.min(100, Math.max(0, Math.round(pct)))
  return (
    <div className="grid content-start gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="text-sm font-medium">{label}</h3>
        <span className={cn("text-xs", level === "ok" ? "text-muted-foreground" : level === "warn" ? "text-warning" : "text-destructive")}>{words[level]}</span>
      </div>
      <div className="relative">
        <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={p} className="h-2 overflow-hidden rounded-full bg-muted">
          <div className={cn("h-full rounded-full", FILL[level])} style={{ width: `${p}%` }} />
        </div>
        {marks?.map(([at, what]) => (
          <span key={what} aria-hidden title={what} className="absolute -top-0.5 h-3 w-px bg-foreground/60" style={{ left: `${Math.min(99, Math.max(1, at))}%` }} />
        ))}
      </div>
      <p className="text-sm text-muted-foreground tabular-nums">{children}</p>
    </div>
  )
}

// Server resources, in plain words. The colours follow the same lines image builds use: they wait to start
// past the first, and are stopped past the second.
export async function ResourcesCard() {
  const [m, s] = await Promise.all([hostMetrics(), getSettings()])
  const ram: Level = m.memUsedPct >= s.registryBuildGuardRamPct ? "bad" : m.memUsedPct >= s.registryBuildPreflightRamPct ? "warn" : "ok"
  const loadPct = (m.load1 / (m.cores * 1.5)) * 100
  const load: Level = m.load1 > m.cores * 1.5 ? "warn" : "ok"
  return (
    <section aria-labelledby="resources-title" className={cn(FRAME, "grid max-w-3xl gap-4 px-5 py-4")}>
      <div className="grid gap-0.5">
        <h2 id="resources-title" className="text-sm font-semibold">
          Server resources
        </h2>
        <p className="text-sm text-pretty text-muted-foreground">
          Memory, processor load and disk space on this machine. The marks on the bars are where image builds wait to start (memory above {s.registryBuildPreflightRamPct}%, free disk below {s.registryBuildMinDiskGb} GB) and where they are stopped
          (memory above {s.registryBuildGuardRamPct}%, free disk below {s.registryBuildGuardDiskGb} GB).
        </p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {m.memTotal > 0 && (
          <Meter label="Memory" pct={m.memUsedPct} level={ram} marks={[[s.registryBuildPreflightRamPct, "Builds wait above this"], [s.registryBuildGuardRamPct, "Builds are stopped above this"]]}>
            {m.memUsedPct}% used ({((m.memTotal - m.memAvailable) / GB).toFixed(1)} of {(m.memTotal / GB).toFixed(1)} GB)
          </Meter>
        )}
        <Meter label="Processor load" pct={loadPct} level={load}>
          {m.load1.toFixed(1)} busy of {m.cores} {m.cores === 1 ? "core" : "cores"}. Builds wait when load passes 1.5 per core, where the bar is full.
        </Meter>
        {m.disk.map((d) => {
          const freeGb = d.free / GB
          const level: Level = freeGb < s.registryBuildGuardDiskGb ? "bad" : freeGb < s.registryBuildMinDiskGb ? "warn" : "ok"
          return (
            <Meter
              key={d.path}
              label={`Disk ${d.path}`}
              pct={d.total ? ((d.total - d.free) / d.total) * 100 : 0}
              level={level}
              words={DISK_WORD}
              marks={d.total ? [[100 - (s.registryBuildMinDiskGb * GB * 100) / d.total, "Builds wait past this"], [100 - (s.registryBuildGuardDiskGb * GB * 100) / d.total, "Builds are stopped past this"]] : undefined}
            >
              {formatBytes(d.free)} free of {formatBytes(d.total)}
            </Meter>
          )
        })}
      </div>
    </section>
  )
}
