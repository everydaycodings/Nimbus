"use server"

import type {
  DocumentPatch,
  DocumentsQuery,
  DocumentsTotalsQuery,
} from "@nimbus/shared/documents-api"

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

export async function listDocs(q: DocumentsQuery) {
  return docs.listDocuments(await member(), q)
}

// Everything the previewer's panel needs for one file; doc is null when it isn't a document.
export async function getDocPanel(id: string) {
  const me = await member()
  const [doc, types, senders] = await Promise.all([
    docs.getDocument(me, id),
    docs.listTypes(me),
    docs.listSenders(me),
  ])
  return { doc, types, senders }
}

export async function saveDoc(id: string, patch: DocumentPatch) {
  return docs.updateDocument(await member(), id, patch)
}

export async function markDocs(ids: string[]) {
  return docs.markDocuments(await member(), ids)
}

// "Not a document": hides the files from Documents, they stay where they are.
export async function dismissDocs(ids: string[]) {
  const me = await member()
  for (const id of ids) {
    const r = await docs.updateDocument(me, id, { status: "dismissed" })
    if (r.error) return r
  }
  return {}
}

export async function bulkDocs(b: {
  ids: string[]
  typeId?: string | null
  senderId?: string | null
  confirm?: boolean
}) {
  return docs.bulk(await member(), b)
}

export async function mergeDocs(ids: string[]) {
  return docs.mergePdf(await member(), ids)
}

export async function docTotals(q: DocumentsTotalsQuery) {
  return { rows: await docs.totals(await member(), q) }
}

export async function docUploadTarget() {
  return docs.uploadTarget(await member())
}

// ---- Settings page ----

export async function saveDocType(
  b: { name: string; remindDays: number | null },
  id?: string
) {
  return docs.saveType(await member(), b, id)
}
export async function removeDocType(id: string) {
  return docs.deleteType(await member(), id)
}
export async function renameSender(id: string, name: string) {
  return docs.updateSender(await member(), id, { name })
}
export async function removeSender(id: string) {
  return docs.deleteSender(await member(), id)
}
export async function mergeSender(from: string, into: string) {
  return docs.mergeSenders(await member(), from, into)
}
export async function addDocWatch(folderId: string) {
  return docs.addWatch(await member(), folderId)
}
export async function removeDocWatch(folderId: string) {
  return docs.removeWatch(await member(), folderId)
}
