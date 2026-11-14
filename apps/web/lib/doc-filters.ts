// The Documents page keeps its filters in the URL, so they survive reloads and can be shared.
// Pure: the page (server) and the view (client) both read and write them.
import type { DocumentsQuery } from "@nimbus/shared/documents-api"

export const TABS = ["all", "review", "totals", "hidden"] as const
export type Tab = (typeof TABS)[number]

export type Filters = {
  tab: Tab
  q: string
  type: string
  sender: string
  year: string
  from: string
  to: string
  min: string
  max: string
  expiring: "" | "soon" | "expired" | "any"
  missing: string
  sort: "date" | "name" | "amount" | "expires" | "added"
  order: "asc" | "desc"
}

const pick = <T extends string>(
  v: string | undefined,
  all: readonly T[],
  d: T
) => (all.includes(v as T) ? (v as T) : d)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY = /^\d{4}-\d{2}-\d{2}$/
const num = (v: string | undefined) =>
  v && v.trim() !== "" && Number.isFinite(Number(v)) ? String(Number(v)) : ""

export function readFilters(
  sp: Record<string, string | string[] | undefined>
): Filters {
  const one = (k: string) =>
    typeof sp[k] === "string" ? (sp[k] as string) : undefined
  return {
    tab: pick(one("tab"), TABS, "all"),
    q: (one("q") ?? "").slice(0, 200),
    type: UUID.test(one("type") ?? "") ? one("type")! : "",
    sender: UUID.test(one("sender") ?? "") ? one("sender")! : "",
    year: /^\d{4}$/.test(one("year") ?? "") ? one("year")! : "",
    from: DAY.test(one("from") ?? "") ? one("from")! : "",
    to: DAY.test(one("to") ?? "") ? one("to")! : "",
    min: num(one("min")),
    max: num(one("max")),
    expiring: pick(
      one("expiring"),
      ["soon", "expired", "any"] as const,
      "" as "soon"
    ),
    missing: pick(
      one("missing"),
      ["type", "sender", "date", "amount", "expiry"] as const,
      "" as "type"
    ),
    sort: pick(
      one("sort"),
      ["date", "name", "amount", "expires", "added"] as const,
      "date"
    ),
    order: pick(one("order"), ["asc", "desc"] as const, "desc"),
  }
}

export const DEFAULT: Filters = readFilters({})

// Only what differs from the defaults, so the plain page has a plain URL.
export function toParams(f: Filters) {
  const p = new URLSearchParams()
  for (const k of Object.keys(DEFAULT) as (keyof Filters)[])
    if (f[k] !== DEFAULT[k]) p.set(k, f[k])
  return p
}

export const hrefOf = (f: Filters) => {
  const s = toParams(f).toString()
  return s ? `/documents?${s}` : "/documents"
}

// How many filters (not the tab, search or sort) are set.
export const activeCount = (f: Filters) =>
  [
    f.type,
    f.sender,
    f.year,
    f.from || f.to,
    f.min || f.max,
    f.expiring,
    f.missing,
  ].filter(Boolean).length

export function toQuery(f: Filters): DocumentsQuery {
  return {
    q: f.q.trim() || undefined,
    type: f.type || undefined,
    sender: f.sender || undefined,
    status:
      f.tab === "review"
        ? "review"
        : f.tab === "hidden"
          ? "dismissed"
          : undefined,
    from: f.from || undefined,
    to: f.to || undefined,
    year: f.year ? Number(f.year) : undefined,
    minAmount: f.min ? Number(f.min) : undefined,
    maxAmount: f.max ? Number(f.max) : undefined,
    expiring: f.expiring || undefined,
    missing: f.missing || undefined,
    sort: f.sort,
    order: f.order,
    limit: 100,
  }
}
