// Types for /api/v1/documents (the Documents section). Plain types only, like api.ts.
// Dates are YYYY-MM-DD (document date, expiry) or ISO 8601 (timestamps). Amounts are plain numbers.

export type DocStatus = "review" | "confirmed" | "dismissed"
export type DocField = "type" | "sender" | "date" | "amount" | "expiry"

export type DocType = {
  id: string
  /** Preset types have a key and can't be renamed or deleted. */
  key: string | null
  name: string
  preset: boolean
  /** Days before the expiry or due date to remind. Null: never. */
  remindDays: number | null
}

export type DocSender = {
  id: string
  name: string
  patterns: string[]
  /** Documents (not dismissed) with this sender. */
  count: number
}

/** What the extractor and the picture model thought, kept so the panel can say "Guessed ...". */
export type DocGuess = {
  type?: string | null
  sender?: string | null
  date?: string | null
  amount?: number | null
  currency?: string | null
  expiry?: string | null
  confidence?: number
  /** nimbus-ml (CLIP) hint for a picture: a type key and how sure it was (0 to 1). */
  clip?: { type: string; score: number }
}

export type DocumentItem = {
  /** The file's id, so every /files route and the previewer work with it. */
  id: string
  name: string
  mime: string | null
  size: number
  /** Current file version. */
  version: string | null
  thumb: string | null
  folderId: string | null
  updatedAt: string
  /** "owner": mine and editable. "viewer": shared with me, fields are read-only. */
  role: "owner" | "viewer"
  /** Owner's name when role is "viewer". */
  owner: string | null
  status: DocStatus
  source: "auto" | "manual"
  typeId: string | null
  typeName: string | null
  senderId: string | null
  senderName: string | null
  docDate: string | null
  amount: number | null
  currency: string | null
  expiresAt: string | null
  /** Lead time in force: the document's own, else its type's. */
  remindDays: number | null
  /** The document's own override; null: follows the type. */
  remindOverride: number | null
  notes: string | null
  fields: Record<string, string>
  guess: DocGuess
  /** Another file that looks like the same document. */
  dupOf: { id: string; name: string } | null
  /** Fields still empty. */
  missing: DocField[]
  /** Whole days to the expiry, negative when past; null with no expiry. */
  daysLeft: number | null
}

export type DocumentDetail = DocumentItem & {
  /** The file's text (PDF layer or OCR), first 20 000 characters; null when not read yet. */
  text: string | null
}

// ---- GET /documents ----
export type DocumentsQuery = {
  q?: string
  /** Type id. */
  type?: string
  /** Sender id. */
  sender?: string
  /** "review": Needs review. "dismissed": the Not a document list. Default: confirmed and review. */
  status?: DocStatus
  /** YYYY-MM-DD, on the document date. */
  from?: string
  to?: string
  year?: number
  minAmount?: number
  maxAmount?: number
  currency?: string
  /** "soon": inside its reminder window, "expired": past, "any": has an expiry. */
  expiring?: "soon" | "expired" | "any"
  /** Comma separated DocField names. */
  missing?: string
  /** Default "1": include confirmed documents shared with me (read-only). */
  shared?: "0" | "1"
  sort?: "date" | "name" | "amount" | "expires" | "added"
  order?: "asc" | "desc"
  limit?: number
  /** Offset; send back `nextCursor`. */
  cursor?: number
}
export type DocumentsResponse = { items: DocumentItem[]; total: number; nextCursor: number | null }

// ---- PATCH /documents/{id} -> { item: DocumentDetail } (owner only). Editing fields never changes status: send status "confirmed" with the edit to confirm. ----
export type DocumentPatch = {
  typeId?: string | null
  senderId?: string | null
  /** Names a sender: an existing one (case-insensitive) or a new one. Wins over senderId. */
  senderName?: string | null
  docDate?: string | null
  amount?: number | null
  currency?: string | null
  expiresAt?: string | null
  /** Null: follow the type. */
  remindDays?: number | null
  notes?: string | null
  fields?: Record<string, string>
  status?: DocStatus
}

// ---- POST /documents  { ids } : mark files as documents (and un-dismiss) ----
export type MarkDocumentsRequest = { ids: string[] }

// ---- POST /documents/bulk ----
export type DocumentsBulkRequest = {
  ids: string[]
  typeId?: string | null
  senderId?: string | null
  confirm?: boolean
}
export type DocumentsBulkResponse = { updated: number }

// ---- GET /documents/totals ----
export type DocumentsTotalsQuery = {
  by: "sender" | "type"
  period: "month" | "year"
  /** Limit to one document year. */
  year?: number
}
export type DocumentsTotalRow = {
  /** "2025-03" or "2025". */
  period: string
  /** Sender or type id; null: none set. */
  key: string | null
  label: string
  currency: string
  total: number
  count: number
}
export type DocumentsTotalsResponse = { rows: DocumentsTotalRow[] }

// ---- GET /documents/summary ----
export type DocumentsSummary = {
  /** Documents needing review. */
  review: number
  total: number
  /** Inside the reminder window (default 30 days) or expired in the last 30 days, soonest first, at most 10. */
  expiring: DocumentItem[]
}

// ---- /documents/types, /documents/senders, /documents/watch ----
export type DocTypesResponse = { types: DocType[] }
export type DocTypeBody = { name: string; remindDays: number | null }
export type DocSendersResponse = { senders: DocSender[] }
export type DocSenderPatch = { name?: string; patterns?: string[] }
export type DocSenderMerge = { from: string; into: string }
export type DocWatchFolder = { id: string; name: string; path: string }
/** folders: everything in them counts; ignored: nothing in them counts unless marked by hand. */
export type DocWatchResponse = { folders: DocWatchFolder[]; ignored: DocWatchFolder[] }

// ---- POST /documents/upload-target { date? } ----
/** Documents/<year> (made when missing): upload new documents into it. */
export type DocUploadTarget = { folderId: string; path: string }

// ---- POST /documents/merge { ids, name? } : images and PDFs into one new PDF in Documents/<year> ----
export type DocMergeRequest = { ids: string[]; name?: string }
export type DocMergeResponse = { id: string; name: string; folderId: string }
