import type {
  Details,
  FolderResponse,
  Hit,
  Item,
  ListQuery,
  ListResponse,
  Me,
  PickerResponse,
  PreviewResponse,
  Role,
  StorageReport,
  Tag,
  TagColor,
  TagResponse,
  TagSnapshot,
  TagsResponse,
  TrashResponse,
  UpdateTagResponse,
} from "@nimbus/shared/api"
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query"
import { router } from "expo-router"
import { useCallback, useMemo } from "react"

import { useSnack } from "@/components/snackbar"
import { useAccounts } from "./accounts"
import { errorText, json, send } from "./api"
import { firstFrameToWebp } from "./thumbs"

// ---- Calling the API as the active account ----

// Every screen using this sits under (tabs) or a screen opened from it, so there
// is an active account; signing out unmounts them.
export function useApi() {
  const { active } = useAccounts()
  return useMemo(() => {
    const call =
      (method: string) =>
      <T = Record<string, never>,>(path: string, body?: unknown) =>
        json<T>(active!.server, `/api/v1${path}`, {
          method,
          token: active!.token,
          body: body === undefined ? undefined : JSON.stringify(body),
        })
    return {
      account: active!,
      id: active?.id ?? "",
      get: call("GET"),
      post: call("POST"),
      put: call("PUT"),
      patch: call("PATCH"),
      del: call("DELETE"),
    }
  }, [active])
}

export function useMe() {
  const api = useApi()
  return useQuery({ queryKey: ["me", api.id], queryFn: () => api.get<Me>("/me") })
}

// ---- Lists ----

export type Source =
  | { kind: "files" | "recent" | "starred" | "trash" }
  | { kind: "shared"; by?: "me" }
  | { kind: "folder" | "tag"; id: string }
  | { kind: "search"; q: string }

export type Filters = Pick<ListQuery, "type" | "modified" | "size" | "tag">

const PAGE = 100

const qs = (params: Record<string, string | number | undefined>) => {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
  return parts.length ? `?${parts.join("&")}` : ""
}

function pathOf(s: Source) {
  switch (s.kind) {
    case "folder":
      return `/folders/${s.id}`
    case "tag":
      return `/tags/${s.id}`
    default:
      return `/${s.kind}`
  }
}

// These keep the server's order (last opened, relevance, last trashed).
export const keepsServerOrder = (s: Source) => s.kind === "recent" || s.kind === "search" || s.kind === "trash"

export type ListPage = ListResponse<Item | Hit> &
  Partial<Pick<FolderResponse, "folder" | "path">> &
  Partial<Pick<TrashResponse, "retentionDays">> &
  Partial<Pick<TagResponse, "tag" | "count">>

export function useList(source: Source, query: ListQuery) {
  const api = useApi()
  const extra = {
    ...(source.kind === "search" ? { q: source.q } : {}),
    ...(source.kind === "shared" ? { by: source.by } : {}),
  }
  const list = useInfiniteQuery({
    queryKey: [api.id, "list", pathOf(source), extra, query],
    enabled: source.kind !== "search" || !!source.q,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: ListPage) => last.nextCursor ?? undefined,
    queryFn: ({ pageParam }) =>
      api.get<ListPage>(`${pathOf(source)}${qs({ ...extra, ...query, limit: PAGE, cursor: pageParam })}`),
  })
  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data])
  return { ...list, items, first: list.data?.pages[0] }
}

export function useDetails(id: string) {
  const api = useApi()
  return useQuery({
    queryKey: [api.id, "item", id],
    queryFn: () => api.get<{ item: Item | null; details: Details }>(`/items/${id}`),
  })
}

export function useFolders(parent: string | null) {
  const api = useApi()
  return useQuery({
    queryKey: [api.id, "picker", parent],
    queryFn: () => api.get<PickerResponse>(`/picker${qs({ parent: parent ?? undefined })}`),
  })
}

export function useTags() {
  const api = useApi()
  return useQuery({
    queryKey: [api.id, "tags"],
    queryFn: () => api.get<TagsResponse>("/tags"),
    select: (d) => d.tags,
  })
}

export function useStorage(folder: string | null) {
  const api = useApi()
  return useQuery({
    queryKey: [api.id, "storage", folder],
    queryFn: () => api.get<StorageReport>(`/storage${qs({ folder: folder ?? undefined })}`),
  })
}

// ---- What the sheets are told to show. browser.tsx holds one of these at a time. ----

export type FileSheet =
  | { kind: "actions"; items: Item[] }
  | { kind: "details"; item: Item }
  | { kind: "tags"; items: Item[] }
  | { kind: "move"; items: Item[] }
  | { kind: "new"; parentId: string | null }
  | { kind: "filter"; filter: "type" | "modified" | "size" | "tag" }
  | { kind: "sort" }

// ---- Who may do what: the web's rules, from actions() in components/file-browser.tsx ----

// `context` is the role in the folder being viewed; "owner" everywhere else.
export const roleOf = (item: Item, context: Role = "owner"): Role => item.role ?? context
export const editable = (items: Item[], context?: Role) =>
  items.length > 0 && items.every((i) => roleOf(i, context) !== "viewer" && !i.shortcut)

export const label = (items: Pick<Item, "name">[]) =>
  items.length === 1 ? `“${items[0].name}”` : `${items.length} items`

// ---- Changing things ----

// Every action says how it went in a snackbar, as on the web. The ones behind a
// text field return their error instead, so the dialog can show it.
export function useFileActions() {
  const api = useApi()
  const client = useQueryClient()
  const snack = useSnack()

  const refresh = useCallback(() => {
    client.invalidateQueries({ queryKey: [api.id] })
    client.invalidateQueries({ queryKey: ["me", api.id] })
  }, [client, api.id])

  const run = useCallback(
    async (task: () => Promise<unknown>, text: string, undo?: () => void) => {
      try {
        await task()
        refresh()
        snack({ text, undo })
        return true
      } catch (e) {
        snack({ text: errorText(e), error: true })
        return false
      }
    },
    [refresh, snack]
  )

  // For text fields: the error to show, or nothing when it worked.
  const attempt = useCallback(
    async (task: () => Promise<unknown>, text: string) => {
      try {
        await task()
        refresh()
        snack({ text })
      } catch (e) {
        return errorText(e)
      }
    },
    [refresh, snack]
  )

  return useMemo(() => {
    const ids = (items: Item[]) => items.map((i) => i.id)
    const restore = (items: Item[]) =>
      run(() => api.post("/items/restore", { ids: ids(items) }), `Restored ${label(items)}.`)
    return {
      refresh,
      restore,
      star: (items: Item[]) => {
        const on = !items.every((i) => i.starred)
        return run(
          () => api.post("/items/star", { ids: ids(items), starred: on }),
          on ? `Added ${label(items)} to starred.` : `Removed ${label(items)} from starred.`
        )
      },
      trash: (items: Item[]) =>
        run(
          () => api.post("/items/trash", { ids: ids(items) }),
          `Moved ${label(items)} to the trash.`,
          () => restore(items)
        ),
      remove: (items: Item[]) =>
        run(() => api.post("/items/delete", { ids: ids(items) }), `Deleted ${label(items)} forever.`),
      emptyTrash: () => run(() => api.post("/trash/empty"), "Emptied the trash."),
      move: (items: Item[], parentId: string | null, to: string) =>
        run(() => api.post("/items/move", { ids: ids(items), parentId }), `Moved ${label(items)} to “${to}”.`),
      addShortcut: (item: Item) =>
        run(() => api.post("/shortcuts", { nodeId: item.id }), `Added a shortcut to “${item.name}” in My files.`),
      removeShortcut: (item: Item) =>
        run(() => api.del(`/shortcuts/${item.id}`), `Removed the shortcut to “${item.name}”.`),
      // Throws: the caller is holding a frame and says how it went.
      setThumb: async (item: Item, webp: Uint8Array) => {
        const r = await send(api.account.server, `/api/files/${item.id}/thumb?v=${item.version}`, {
          method: "POST",
          token: api.account.token,
          headers: { "content-type": "image/webp" },
          body: webp as unknown as BodyInit,
        })
        if (!r.ok) throw new Error("The server didn't accept that thumbnail. Try again.")
        refresh()
      },
      // The server redraws other types itself after a couple of minutes, but never video.
      resetThumb: (item: Item, isVideo: boolean) =>
        run(async () => {
          const { server, token } = api.account
          const r = await send(server, `/api/files/${item.id}/thumb`, { method: "DELETE", token })
          if (!r.ok) throw new Error("Couldn't reset the thumbnail. Try again.")
          if (!isVideo) return
          let body: Uint8Array | undefined
          try {
            const { url } = await api.get<PreviewResponse>(`/items/${item.id}/preview`)
            body = await firstFrameToWebp(url)
          } catch {} // An empty post tells the server not to wait for one.
          await send(server, `/api/files/${item.id}/thumb?v=${item.version}`, {
            method: "POST",
            token,
            headers: body ? { "content-type": "image/webp" } : undefined,
            body: body as unknown as BodyInit | undefined,
          })
        }, "Thumbnail reset."),
      deleteOlderVersions: (id: string, name: string) =>
        run(() => api.del(`/items/${id}/versions`), `Deleted the older versions of “${name}”.`),

      rename: (item: Item, name: string) =>
        attempt(() => api.patch(`/items/${item.id}`, { name }), `Renamed to “${name}”.`),
      newFolder: (parentId: string | null, name: string) =>
        attempt(() => api.post("/folders", { parentId, name }), `Created “${name}”.`),

      // Quiet: the tag sheet shows the change as it happens.
      applyTag: async (items: Item[], tagId: string, on: boolean) => {
        try {
          await api.post("/tags/apply", { ids: ids(items), tagId, on })
          refresh()
        } catch (e) {
          snack({ text: errorText(e), error: true })
        }
      },
      createTag: (name: string, color: TagColor, applyTo?: string[]) =>
        attempt(() => api.post("/tags", { name, color, applyTo }), `Created tag “${name}”.`),

      // The tag editor (app/tags.tsx). `merge` set: another tag has that name, so ask first.
      updateTag: async (tag: Tag, name: string, color: TagColor): Promise<{ error?: string; merge?: string }> => {
        try {
          if (name !== tag.name) {
            const res = await api.patch<UpdateTagResponse>(`/tags/${tag.id}`, { name })
            if (res.merge) return { merge: res.merge }
          }
          if (color !== tag.color) await api.patch(`/tags/${tag.id}`, { color })
          refresh()
          snack({ text: `Saved tag “${name}”.` })
          return {}
        } catch (e) {
          return { error: errorText(e) }
        }
      },
      mergeTag: (tag: Tag, into: Tag) =>
        run(() => api.post(`/tags/${tag.id}/merge`, { into: into.id }), `Merged “${tag.name}” into “${into.name}”.`),
      tagCount: async (id: string) => {
        const res = await api.get<TagResponse>(`/tags/${id}?limit=1`)
        return res.count
      },
      deleteTag: async (tag: Tag) => {
        try {
          const snap = await api.del<TagSnapshot>(`/tags/${tag.id}`)
          refresh()
          snack({
            text: `Deleted tag “${tag.name}”.`,
            undo: () => run(() => api.post("/tags/restore", snap), `Restored tag “${tag.name}”.`),
          })
        } catch (e) {
          snack({ text: errorText(e), error: true })
        }
      },
    }
  }, [api, attempt, refresh, run, snack])
}

// After a 401 or a gate: forget what's known about this account, and let the
// landing screen (app/index.tsx) decide where to go.
export function useRestart() {
  const api = useApi()
  const client = useQueryClient()
  return useCallback(() => {
    client.removeQueries({ queryKey: ["me", api.id] })
    router.replace("/")
  }, [client, api.id])
}
