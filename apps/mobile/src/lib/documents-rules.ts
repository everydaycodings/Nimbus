// The rules behind the Documents screens: filters to a query, expiry wording, the editor's form to a patch,
// and what a waiting change does to a list. No React or native imports, so node --test can run them.
import type { Item } from "@nimbus/shared/api"
import type { DocField, DocStatus, DocumentItem, DocumentPatch } from "@nimbus/shared/documents-api"

export type DocSort = "date" | "name" | "amount" | "expires" | "added"

// What the filter chips and the search box hold.
export type DocFilters = {
  q: string
  status?: DocStatus
  type?: string
  sender?: string
  year?: number
  from?: string
  to?: string
  minAmount?: string
  maxAmount?: string
  currency?: string
  expiring?: "soon" | "expired" | "any"
  missing: DocField[]
  sort: DocSort
  order: "asc" | "desc"
}

export const NO_FILTERS: DocFilters = { q: "", missing: [], sort: "date", order: "desc" }

export const MISSING_LABEL: Record<DocField, string> = { type: "Type", sender: "Sender", date: "Date", amount: "Amount", expiry: "Expiry" }
export const EXPIRING_LABEL = { soon: "Expiring soon", expired: "Expired", any: "Has an expiry" } as const
export const SORT_LABEL: Record<DocSort, string> = { date: "Document date", name: "Name", amount: "Amount", expires: "Expiry", added: "Date added" }

// A typed amount: "1,234.50" or "1234,5" both work. null for empty or not a number.
export function parseAmount(text: string): number | null {
  const t = text.trim().replace(/\s/g, "")
  if (!t) return null
  const n = Number(/,\d{1,2}$/.test(t) && !t.includes(".") ? t.replace(",", ".") : t.replace(/,/g, ""))
  return Number.isFinite(n) && n >= 0 ? n : null
}

// How many chips are lit: one per kind of filter, not per value.
export function filterCount(f: DocFilters) {
  return (
    (f.type ? 1 : 0) +
    (f.sender ? 1 : 0) +
    (f.year || f.from || f.to ? 1 : 0) +
    (parseAmount(f.minAmount ?? "") !== null || parseAmount(f.maxAmount ?? "") !== null ? 1 : 0) +
    (f.expiring ? 1 : 0) +
    (f.missing.length ? 1 : 0)
  )
}

// The query string of GET /documents; `cursor` is the offset to carry on from.
export function toQuery(f: DocFilters, limit: number, cursor?: number | null) {
  const min = parseAmount(f.minAmount ?? "")
  const max = parseAmount(f.maxAmount ?? "")
  const q: Record<string, string | number | undefined> = {
    q: f.q.trim() || undefined,
    status: f.status,
    type: f.type,
    sender: f.sender,
    year: f.year,
    from: f.from,
    to: f.to,
    minAmount: min ?? undefined,
    maxAmount: max ?? undefined,
    currency: f.currency,
    expiring: f.expiring,
    missing: f.missing.length ? f.missing.join(",") : undefined,
    sort: f.sort,
    order: f.order,
    limit,
    cursor: cursor ?? undefined,
  }
  return Object.entries(q)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&")
}

export type Tone = "danger" | "warn" | "muted"

// The line under a document that has an expiry or due date; null without one.
export function expiryInfo(d: Pick<DocumentItem, "daysLeft" | "remindDays" | "expiresAt">): { text: string; tone: Tone } | null {
  const left = d.daysLeft
  if (left === null || !d.expiresAt) return null
  const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`
  if (left < 0) return { text: `Expired ${days(-left)} ago`, tone: "danger" }
  if (left === 0) return { text: "Due today", tone: "danger" }
  if (left <= (d.remindDays ?? 30)) return { text: `In ${days(left)}`, tone: "warn" }
  return { text: `Until ${d.expiresAt}`, tone: "muted" }
}

export const money = (amount: number | null, currency: string | null) =>
  amount === null
    ? null
    : (() => {
        try {
          return new Intl.NumberFormat(undefined, currency ? { style: "currency", currency } : { minimumFractionDigits: 2 }).format(amount)
        } catch {
          return `${amount.toFixed(2)} ${currency ?? ""}`.trim()
        }
      })()

// YYYY-MM-DD as the reader's date, without time zones moving it a day.
export function dayText(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { dateStyle: "medium" })
}

export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

// ---- The editor ----

export type Form = {
  typeId: string | null
  sender: string
  docDate: string | null
  amount: string
  currency: string
  expiresAt: string | null
  remindDays: string
  notes: string
  fields: { k: string; v: string }[]
}

export const formFrom = (d: DocumentItem): Form => ({
  typeId: d.typeId,
  sender: d.senderName ?? "",
  docDate: d.docDate,
  amount: d.amount === null ? "" : String(d.amount),
  currency: d.currency ?? "",
  expiresAt: d.expiresAt,
  remindDays: d.remindOverride === null ? "" : String(d.remindOverride),
  notes: d.notes ?? "",
  fields: Object.entries(d.fields).map(([k, v]) => ({ k, v })),
})

const record = (rows: Form["fields"]) => {
  const out: Record<string, string> = {}
  for (const { k, v } of rows) if (k.trim()) out[k.trim()] = v.trim()
  return out
}

// Only what changed, or the first thing wrong with the form.
export function patchFrom(form: Form, d: DocumentItem): { patch: DocumentPatch } | { error: string } {
  const patch: DocumentPatch = {}
  if (form.typeId !== d.typeId) patch.typeId = form.typeId
  if (form.sender.trim() !== (d.senderName ?? "")) {
    if (form.sender.trim()) patch.senderName = form.sender.trim()
    else patch.senderId = null
  }
  if (form.docDate !== d.docDate) patch.docDate = form.docDate
  const amount = parseAmount(form.amount)
  if (form.amount.trim() && amount === null) return { error: "The amount isn't a number." }
  if (amount !== d.amount) patch.amount = amount
  const cur = form.currency.trim().toUpperCase()
  if (cur && !/^[A-Z]{3}$/.test(cur)) return { error: "Use a three letter currency code, like USD." }
  if ((cur || null) !== d.currency) patch.currency = cur || null
  if (form.expiresAt !== d.expiresAt) patch.expiresAt = form.expiresAt
  const rd = form.remindDays.trim()
  if (rd && !/^\d{1,4}$/.test(rd)) return { error: "Remind days is a whole number." }
  const remind = rd ? Number(rd) : null
  if (remind !== d.remindOverride) patch.remindDays = remind
  if (form.notes.trim() !== (d.notes ?? "")) patch.notes = form.notes.trim() || null
  const fields = record(form.fields)
  if (JSON.stringify(Object.entries(fields)) !== JSON.stringify(Object.entries(d.fields))) patch.fields = fields
  return { patch }
}

// ---- Waiting changes (offline-queue.ts) ----

export type DocOp =
  | { op: "docPatch"; id: string; patch: DocumentPatch; typeName?: string | null }
  | { op: "docMark"; ids: string[]; on: boolean }

// What one waiting change does to one list; `listStatus` is the list's own status filter.
export function applyDocOp(items: DocumentItem[], op: DocOp, listStatus?: DocStatus): DocumentItem[] {
  if (op.op === "docMark") {
    if (op.on) return listStatus === "dismissed" ? items.filter((d) => !op.ids.includes(d.id)) : items
    return listStatus === "dismissed" ? items : items.filter((d) => !op.ids.includes(d.id))
  }
  const { patch } = op
  if (patch.status === "dismissed" && listStatus !== "dismissed") return items.filter((d) => d.id !== op.id)
  if (patch.status === "review" && listStatus === "dismissed") return items.filter((d) => d.id !== op.id)
  if (patch.status === "confirmed" && listStatus === "review") return items.filter((d) => d.id !== op.id)
  return items.map((d) => (d.id === op.id ? applyPatch(d, op) : d))
}

export function applyPatch(d: DocumentItem, op: Extract<DocOp, { op: "docPatch" }>): DocumentItem {
  const p = op.patch
  const next = { ...d }
  if ("typeId" in p) {
    next.typeId = p.typeId ?? null
    next.typeName = p.typeId ? (op.typeName ?? d.typeName) : null
  }
  if (p.senderName) next.senderName = p.senderName
  else if ("senderId" in p && !p.senderId) {
    next.senderId = null
    next.senderName = null
  }
  if ("docDate" in p) next.docDate = p.docDate ?? null
  if ("amount" in p) next.amount = p.amount ?? null
  if ("currency" in p) next.currency = p.currency ?? null
  if ("expiresAt" in p) next.expiresAt = p.expiresAt ?? null
  if ("remindDays" in p) next.remindOverride = p.remindDays ?? null
  if ("notes" in p) next.notes = p.notes ?? null
  if (p.fields) next.fields = p.fields
  if (p.status) next.status = p.status
  return next
}

// ---- The previewer ----

// A document is a file, so the previewer and file menus open it as one.
export const toItem = (d: DocumentItem): Item => ({
  id: d.id,
  kind: "file",
  name: d.name,
  size: d.size,
  mime: d.mime,
  starred: false,
  updatedAt: d.updatedAt,
  trashedAt: null,
  tags: [],
  version: d.version,
  thumb: d.thumb,
  sharedWithPeople: false,
  hasLink: false,
  ...(d.role === "viewer" ? { role: "viewer" as const, owner: d.owner ?? undefined } : {}),
})
