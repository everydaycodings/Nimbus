// Plain module (no "use client"): the server page reads TABS too.
export { ago, duration, every, PRESETS } from "@/components/gitbackup/format"

export const TABS = [
  ["overview", "Overview"],
  ["snapshots", "Snapshots"],
  ["history", "History"],
  ["settings", "Settings"],
] as const
export type Tab = (typeof TABS)[number][0]

export const BASE = "/more/server-backup"
export const TEXTAREA =
  "min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"

// "source" column to words.
export const sourceLabel = (s: string) => (s === "paths" ? "Folders" : s.startsWith("volume:") ? `Volume ${s.slice(7)}` : s)
