// Words and links for the archive pages. Plain module, shared by server and client components.
export const SCHEDULES: [string, string][] = [
  ["", "Never"],
  ["1440", "Daily"],
  ["10080", "Weekly"],
]

export const FILE = (id: string) => `/api/archive/file/${id}`

export const TABS = [
  ["html", "Page"],
  ["pdf", "PDF"],
  ["png", "Screenshot"],
  ["text", "Text"],
] as const
export type ViewTab = (typeof TABS)[number][0]

export const scheduleText = (m: number | null) => (m === 1440 ? "Daily" : m === 10_080 ? "Weekly" : "Manual")

// "Needs the browser service" in the card and on the pages; the steps are the same everywhere.
export const BROWSER_STEPS = [
  "Start the browser container: docker compose --profile browser up -d browser",
  "In Admin, More tools, Website archive, set the browser address to ws://browser:3000?token=nimbus-browser (or the BROWSER_TOKEN you set).",
]
