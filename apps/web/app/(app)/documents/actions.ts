"use server"

import type {
  DocumentPatch,
  DocumentsQuery,
  DocumentsTotalsQuery,
} from "@nimbus/shared/documents-api"

import { Bulk, Ids, List, Patch, SenderName, Totals, TypeBody} from "@/lib/doc-schemas"
import * as docs from "@/lib/services/documents"
import { requireMember } from "@/lib/session"
import { getSettings } from "@/lib/signup"

// The web's twin of /api/v1/documents/* (the same service).

const member = async () => {
  const me = await requireMember()
  if (!(await getSettings()).documentsEnabled)
    throw new Error("Documents are turned off.")
  return me
}

// The same rules as the REST routes: the browser can send anything to an action.
const BAD = { error: "That isn't valid." }
const uuid = Ids.element
const bad = <T>(s: { safeParse: (v: unknown) => { success: boolean; data?: T } }, v: unknown) => {
  const r = s.safeParse(v)
  return r.success ? (r.data as T) : null
}

export async function listDocs(q: DocumentsQuery) {
  const me = await member()
  const p = bad(List, Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined)))
  if (!p) throw new Error(BAD.error)
  return docs.listDocuments(me, p)
}

// Everything the previewer's panel needs for one file; doc is null when it isn't a document.
export async function getDocPanel(id: string) {
  const me = await member()
  if (!uuid.safeParse(id).success) return { doc: null, types: [], senders: [] }
  const [doc, types, senders] = await Promise.all([
    docs.getDocument(me, id),
    docs.listTypes(me),
    docs.listSenders(me),
  ])
  return { doc, types, senders }
}

export async function saveDoc(id: string, patch: DocumentPatch) {
  const me = await member()
  const p = bad(Patch, patch)
  if (!p || !uuid.safeParse(id).success) return BAD
  return docs.updateDocument(me, id, p)
}

export async function markDocs(ids: string[]) {
  const me = await member()
  const v = bad(Ids, ids)
  return v ? docs.markDocuments(me, v) : BAD
}

// "Not a document": hides the files from Documents, they stay where they are.
export async function dismissDocs(ids: string[]) {
  const me = await member()
  const v = bad(Ids, ids)
  return v ? docs.dismissDocuments(me, v) : BAD
}

export async function bulkDocs(b: {
  ids: string[]
  typeId?: string | null
  senderId?: string | null
  confirm?: boolean
}) {
  const me = await member()
  const v = bad(Bulk, b)
  return v ? docs.bulk(me, v) : BAD
}

export async function mergeDocs(ids: string[]) {
  const me = await member()
  const v = bad(Ids, ids)
  return v && v.length <= 100 ? docs.mergePdf(me, v) : BAD
}

export async function docTotals(q: DocumentsTotalsQuery) {
  const me = await member()
  const v = bad(Totals, q)
  if (!v) throw new Error(BAD.error)
  return { rows: await docs.totals(me, v) }
}

export async function docUploadTarget() {
  return docs.uploadTarget(await member())
}

// ---- Settings page ----

export async function saveDocType(
  b: { name: string; remindDays: number | null },
  id?: string
) {
  const me = await member()
  const v = bad(TypeBody, b)
  return v && (id === undefined || uuid.safeParse(id).success) ? docs.saveType(me, v, id) : BAD
}
export async function removeDocType(id: string) {
  const me = await member()
  return uuid.safeParse(id).success ? docs.deleteType(me, id) : BAD
}
export async function renameSender(id: string, name: string) {
  const me = await member()
  const n = bad(SenderName, name)
  return n && uuid.safeParse(id).success ? docs.updateSender(me, id, { name: n }) : BAD
}
export async function removeSender(id: string) {
  const me = await member()
  return uuid.safeParse(id).success ? docs.deleteSender(me, id) : BAD
}
export async function mergeSender(from: string, into: string) {
  const me = await member()
  return uuid.safeParse(from).success && uuid.safeParse(into).success ? docs.mergeSenders(me, from, into) : BAD
}
export async function addDocWatch(folderId: string) {
  const me = await member()
  return uuid.safeParse(folderId).success ? docs.addWatch(me, folderId) : BAD
}
export async function removeDocWatch(folderId: string) {
  const me = await member()
  return uuid.safeParse(folderId).success ? docs.removeWatch(me, folderId) : BAD
}
