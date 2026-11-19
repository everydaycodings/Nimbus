// Plain module (no "use client"): the server page reads TABS too, and a server component can't read values from a client module.
export const TABS = [
  ["overview", "Overview"],
  ["repos", "Repos"],
  ["history", "History"],
  ["settings", "Settings"],
] as const
export type Tab = (typeof TABS)[number][0]

const EVERY: Record<number, string> = { 15: "15 minutes", 60: "hour", 360: "6 hours", 720: "12 hours", 1440: "day" }

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "short" })

// "2 hours ago", "in 5 minutes"; "Never" for null.
export function ago(iso: string | null, never = "Never"): string {
  if (!iso) return never
  const s = Math.round((new Date(iso).getTime() - Date.now()) / 1000)
  const a = Math.abs(s)
  if (a < 45) return s <= 0 ? "just now" : "in a moment"
  if (a < 3600) return rtf.format(Math.round(s / 60), "minute")
  if (a < 86_400) return rtf.format(Math.round(s / 3600), "hour")
  return rtf.format(Math.round(s / 86_400), "day")
}

export const every = (min: number) => EVERY[min] ?? (min % 1440 === 0 ? `${min / 1440} days` : min % 60 === 0 ? `${min / 60} hours` : `${min} minutes`)

export function duration(from: string, to: string | null): string {
  if (!to) return "Running"
  const s = Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

export const PRESETS = [
  [15, "15 min"],
  [60, "1 hour"],
  [360, "6 hours"],
  [720, "12 hours"],
  [1440, "Daily"],
] as const
