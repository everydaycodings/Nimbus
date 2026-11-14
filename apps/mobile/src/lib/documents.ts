// The Documents section as the active account: lists, details, settings and the changes that can wait offline.
import type {
  DocSender,
  DocSendersResponse,
  DocType,
  DocTypeBody,
  DocTypesResponse,
  DocUploadTarget,
  DocWatchResponse,
  DocMergeResponse,
  DocumentDetail,
  DocumentPatch,
  DocumentsBulkRequest,
  DocumentsResponse,
  DocumentsSummary,
  DocumentsTotalsResponse,
  DocumentsTotalsQuery,
} from "@nimbus/shared/documents-api"
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback, useMemo } from "react"

import { useSnack } from "@/components/snackbar"
import { ApiError, errorText } from "./api"
import { isOnline } from "./connectivity"
import { toQuery, type DocFilters } from "./documents-rules"
import { useApi } from "./files"
import { enqueue, showOptimistically } from "./offline-queue"
import type { Op } from "./offline-rules"

const PAGE = 60
const missing = (e: unknown) => e instanceof ApiError && e.status === 404
const dropped = (e: unknown) => e instanceof ApiError && e.status === 0

// The summary doubles as the "is Documents turned on" check: the server answers 404 when the admin turned it off.
export function useDocSummary() {
  const api = useApi()
  const q = useQuery({
    queryKey: [api.id, "docs", "summary"],
    queryFn: () => api.get<DocumentsSummary>("/documents/summary"),
    retry: (n, e) => !missing(e) && n < 2,
  })
  return { ...q, off: missing(q.error) && !q.data }
}

export function useDocs(filters: DocFilters, enabled = true) {
  const api = useApi()
  const list = useInfiniteQuery({
    queryKey: [api.id, "docs", "list", filters],
    enabled,
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last: DocumentsResponse) => last.nextCursor ?? undefined,
    queryFn: ({ pageParam }) => api.get<DocumentsResponse>(`/documents?${toQuery(filters, PAGE, pageParam)}`),
  })
  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data])
  return { ...list, items, total: list.data?.pages[0]?.total ?? 0 }
}

export function useDocTotals(q: DocumentsTotalsQuery, enabled = true) {
  const api = useApi()
  return useQuery({
    enabled,
    queryKey: [api.id, "docs", "totals", q],
    queryFn: async () => (await api.get<DocumentsTotalsResponse>(`/documents/totals?by=${q.by}&period=${q.period}${q.year ? `&year=${q.year}` : ""}`)).rows,
  })
}

export function useDocTypes() {
  const api = useApi()
  return useQuery({ queryKey: [api.id, "docs", "types"], queryFn: async () => (await api.get<DocTypesResponse>("/documents/types")).types })
}

export function useDocSenders() {
  const api = useApi()
  return useQuery({ queryKey: [api.id, "docs", "senders"], queryFn: async () => (await api.get<DocSendersResponse>("/documents/senders")).senders })
}

export function useDocWatch() {
  const api = useApi()
  return useQuery({ queryKey: [api.id, "docs", "watch"], queryFn: async () => (await api.get<DocWatchResponse>("/documents/watch")).folders })
}

// One file's document row, or null when it isn't one (the server answers 404). Disabled: no request.
export function useDocument(id: string, enabled = true) {
  const api = useApi()
  return useQuery({
    enabled,
    queryKey: [api.id, "docs", "item", id],
    retry: (n, e) => !missing(e) && n < 2,
    queryFn: async () => {
      try {
        return { item: await api.get<DocumentDetail>(`/documents/${id}`) }
      } catch (e) {
        if (missing(e)) return null
        throw e
      }
    },
  })
}

export const typeName = (types: DocType[] | undefined, id: string | null) => types?.find((t) => t.id === id)?.name ?? null
export const senderName = (senders: DocSender[] | undefined, id: string | null) => senders?.find((s) => s.id === id)?.name ?? null

export function useDocActions() {
  const api = useApi()
  const client = useQueryClient()
  const snack = useSnack()

  const refresh = useCallback(() => void client.invalidateQueries({ queryKey: [api.id, "docs"] }), [client, api.id])

  const queueIt = useCallback(
    (op: Op, label: string) => {
      enqueue(api.id, op, label)
      showOptimistically(client, api.id, op)
      snack({ text: "Will sync when online." })
    },
    [client, api.id, snack]
  )

  return useMemo(() => {
    // Waits for a connection when there isn't one; returns the error to show, or nothing.
    const attempt = async (task: () => Promise<unknown>, queued?: { op: Op; label: string }, text?: string, undo?: () => void) => {
      if (queued && !isOnline()) return void queueIt(queued.op, queued.label)
      try {
        await task()
        refresh()
        if (text) snack({ text, undo })
      } catch (e) {
        if (queued && dropped(e)) return void queueIt(queued.op, queued.label)
        return errorText(e)
      }
    }
    const say = (p: Promise<string | void>) => p.then((e) => e && snack({ text: e, error: true }))

    const mark = (ids: string[], on: boolean): Promise<string | void> =>
      attempt(
        () => (on ? api.post("/documents", { ids }) : Promise.all(ids.map((id) => api.patch(`/documents/${id}`, { status: "dismissed" })))),
        { op: { op: "docMark", ids, on }, label: `${on ? "Mark" : "Unmark"} ${ids.length === 1 ? "a document" : `${ids.length} documents`}` },
        on ? "Marked as a document." : "Marked as not a document.",
        () => void say(mark(ids, !on))
      )

    return {
      refresh,
      say,
      mark,
      // Edited fields, or Confirm (patch.status "confirmed"). `names` only labels the change until it syncs.
      patch: (id: string, patch: DocumentPatch, label: string, typeName?: string | null, text?: string) =>
        attempt(() => api.patch(`/documents/${id}`, patch), { op: { op: "docPatch", id, patch, typeName }, label }, text),
      bulk: (body: DocumentsBulkRequest) => attempt(() => api.post("/documents/bulk", body)),
      merge: async (ids: string[], name?: string) => api.post<DocMergeResponse>("/documents/merge", { ids, name }),
      uploadTarget: () => api.post<DocUploadTarget>("/documents/upload-target", {}),
      addType: (b: DocTypeBody) => attempt(() => api.post("/documents/types", b)),
      editType: (id: string, b: DocTypeBody) => attempt(() => api.patch(`/documents/types/${id}`, b)),
      deleteType: (id: string) => attempt(() => api.del(`/documents/types/${id}`)),
      renameSender: (id: string, name: string) => attempt(() => api.patch(`/documents/senders/${id}`, { name })),
      deleteSender: (id: string) => attempt(() => api.del(`/documents/senders/${id}`)),
      mergeSender: (from: string, into: string) => attempt(() => api.post("/documents/senders/merge", { from, into })),
      watch: (folderId: string) => attempt(() => api.post("/documents/watch", { folderId })),
      unwatch: (folderId: string) => attempt(() => api.del(`/documents/watch/${folderId}`)),
    }
  }, [api, refresh, queueIt, snack])
}
