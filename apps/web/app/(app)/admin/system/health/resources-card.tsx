import { FRAME } from "@/components/admin/setting"
import { formatBytes } from "@/lib/file-rules"
import { hostMetrics } from "@/lib/host-metrics"
import { getSettings } from "@/lib/signup"
import { cn } from "@/lib/utils"

const GB = 1024 ** 3
type Level = "ok" | "warn" | "bad"
const FILL: Record<Level, string> = { ok: "bg-success/70", warn: "bg-warning", bad: "bg-destructive" }
const WORD: Record<Level, string> = { ok: "Fine", warn: "Busy", bad: "Critical" }

function Meter({ label, pct, level, children }: { label: string; pct: number; level: Level; children: React.ReactNode }) {
  const p = Math.min(100, Math.max(0, Math.round(pct)))
  return (
    <div className="grid content-start gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="text-sm font-medium">{label}</h3>
        <span className={cn("text-xs", level === "ok" ? "text-muted-foreground" : level === "warn" ? "text-warning" : "text-destructive")}>{WORD[level]}</span>
      </div>
      <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={p} className="h-2 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", FILL[level])} style={{ width: `${p}%` }} />
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
    <section aria-labelledby="resources-title" className={cn(FRAME, "grid gap-4 px-5 py-4")}>
      <div className="grid gap-0.5">
        <h2 id="resources-title" className="text-sm font-semibold">
          Server resources
        </h2>
        <p className="text-sm text-pretty text-muted-foreground">
          Memory, processor load and disk space on this machine. Image builds wait to start when memory is above {s.registryBuildPreflightRamPct}% and are stopped above{" "}
          {s.registryBuildGuardRamPct}%.
        </p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {m.memTotal > 0 && (
          <Meter label="Memory" pct={m.memUsedPct} level={ram}>
            {m.memUsedPct}% used ({((m.memTotal - m.memAvailable) / GB).toFixed(1)} of {(m.memTotal / GB).toFixed(1)} GB)
          </Meter>
        )}
        <Meter label="Processor load" pct={loadPct} level={load}>
          {m.load1.toFixed(1)} busy of {m.cores} {m.cores === 1 ? "core" : "cores"}
        </Meter>
        {m.disk.map((d) => {
          const freeGb = d.free / GB
          const level: Level = freeGb < s.registryBuildGuardDiskGb ? "bad" : freeGb < s.registryBuildMinDiskGb ? "warn" : "ok"
          return (
            <Meter key={d.path} label={`Disk ${d.path}`} pct={d.total ? ((d.total - d.free) / d.total) * 100 : 0} level={level}>
              {formatBytes(d.free)} free of {formatBytes(d.total)}
            </Meter>
          )
        })}
      </div>
    </section>
  )
}
