// Host RAM, load and disk, for the image build guard (scripts/registry-build.ts) and the Health host card.
// Inside a container /proc/meminfo is the host's, which is what the guard wants. No `@/` imports, so
// the runner and node --test share it.
import { readFile, statfs } from "node:fs/promises"
import { cpus, loadavg } from "node:os"

export type HostMetrics = {
  memTotal: number
  memAvailable: number
  memUsedPct: number
  load1: number
  cores: number
  disk: { path: string; total: number; free: number }[]
}

// BUILD_DISK_PATHS (comma separated) names what to watch; by default the work folder and the root.
const diskPaths = () => (process.env.BUILD_DISK_PATHS ?? "/work,/").split(",").map((p) => p.trim()).filter(Boolean)

export async function hostMetrics(): Promise<HostMetrics> {
  let memTotal = 0
  let memAvailable = 0
  try {
    const t = await readFile("/proc/meminfo", "utf8")
    memTotal = Number(/MemTotal:\s+(\d+)/.exec(t)?.[1] ?? 0) * 1024
    memAvailable = Number(/MemAvailable:\s+(\d+)/.exec(t)?.[1] ?? 0) * 1024
  } catch {}
  const disk: HostMetrics["disk"] = []
  for (const path of diskPaths()) {
    try {
      const s = await statfs(path)
      disk.push({ path, total: s.blocks * s.bsize, free: s.bavail * s.bsize })
    } catch {}
  }
  return {
    memTotal,
    memAvailable,
    memUsedPct: memTotal ? Math.round(((memTotal - memAvailable) / memTotal) * 100) : 0,
    load1: loadavg()[0],
    cores: cpus().length || 1,
    disk,
  }
}

export type Thresholds = { ramPct: number; minDiskGb: number; loadFactor?: number }

const GB = 1024 ** 3

// Pure: whether a build may start (preflight: ram 80, disk 5 GB, load 1.5 x cores) or may go on
// (guard: ram 90, disk 2 GB, no load rule). `loadFactor` unset skips the load check.
export function guardVerdict(m: HostMetrics, t: Thresholds): { ok: boolean; reason?: string } {
  if (m.memTotal && m.memUsedPct > t.ramPct) return { ok: false, reason: `RAM ${m.memUsedPct}%, limit ${t.ramPct}%` }
  const low = m.disk.find((d) => d.free < t.minDiskGb * GB)
  if (low) return { ok: false, reason: `disk ${low.path} has ${(low.free / GB).toFixed(1)} GB free, minimum ${t.minDiskGb} GB` }
  if (t.loadFactor && m.load1 > t.loadFactor * m.cores) return { ok: false, reason: `load ${m.load1.toFixed(1)}, limit ${(t.loadFactor * m.cores).toFixed(1)}` }
  return { ok: true }
}
