// Plain module (no "use client"): the server page reads TABS too.
export const TABS = [
  ["rules", "Cleanup rules"],
  ["mirrors", "Mirrors"],
  ["history", "History"],
] as const
export type Tab = (typeof TABS)[number][0]

export const INTERVALS = [
  [60, "Hourly"],
  [360, "Every 6 hours"],
  [720, "Every 12 hours"],
  [1440, "Daily"],
  [10_080, "Weekly"],
] as const

export const short = (digest: string) => digest.replace(/^sha\d+:/, "").slice(0, 12)
