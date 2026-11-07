import type {
  AccountResponse,
  CreateLinkResponse,
  Details,
  FolderResponse,
  Hit,
  Instance,
  Item,
  LinkInfo,
  ListQuery,
  ListResponse,
  Me,
  PickerResponse,
  PreviewResponse,
  Role,
  ShareState,
  StorageReport,
  Tag,
  TagColor,
  TagResponse,
  TagSnapshot,
  TagsResponse,
  TrashResponse,
  UpdateTagResponse,
  VersionsResponse,
} from "@nimbus/shared/api"
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query"
import * as Clipboard from "expo-clipboard"
import { router } from "expo-router"
import { useCallback, useMemo } from "react"
import { Share } from "react-native"

import { useSnack } from "@/components/snackbar"
import { useAccounts } from "./accounts"
import { ApiError, errorText, json, newToken, send } from "./api"
import { isOnline } from "./connectivity"
import { offlineChildren } from "./offline"
import { applyOp, enqueue, queueState, showOptimistically } from "./offline-queue"
import { newTempId, type Op } from "./offline-rules"
import { linkUrl, pickLink } from "./share"
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

// null too: a list restored from disk has its first page's cursor saved as null, not undefined.
const qs = (params: Record<string, string | number | null | undefined>) => {
  const parts = Object.entries(params)
    .filter(([, v]) => v != null && v !== "")
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
    // Search asks once there's text or a filter.
    enabled: source.kind !== "search" || !!(source.q || query.type || query.modified || query.size || query.tag),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: ListPage) => last.nextCursor ?? undefined,
    queryFn: ({ pageParam }) =>
      api.get<ListPage>(`${pathOf(source)}${qs({ ...extra, ...query, limit: PAGE, cursor: pageParam })}`),
  })
  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data])
  return { ...list, items, first: list.data?.pages[0] }
}

export function useDetails(id: string, enabled = true) {
  const api = useApi()
  return useQuery({
    enabled,
    queryKey: [api.id, "item", id],
    queryFn: () => api.get<{ item: Item | null; details: Details }>(`/items/${id}`),
  })
}

export function useFolders(parent: string | null) {
  const api = useApi()
  const client = useQueryClient()
  return useQuery({
    queryKey: [api.id, "picker", parent],
    queryFn: async () => {
      try {
        return await api.get<PickerResponse>(`/picker${qs({ parent: parent ?? undefined })}`)
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 0)) throw e
        return { folders: foldersOnPhone(client, api.id, parent) }
      }
    },
  })
}

// With no connection, the folders in `parent` that this phone already knows: saved lists and kept items,
// with waiting changes applied, so folders made offline can be moved into.
function foldersOnPhone(client: ReturnType<typeof useQueryClient>, account: string, parent: string | null) {
  const path = parent ? `/folders/${parent}` : "/files"
  const seen = new Map<string, Item>()
  for (const q of client.getQueryCache().findAll({ queryKey: [account, "list", path] }))
    for (const page of (q.state.data as { pages?: { items: Item[] }[] } | undefined)?.pages ?? [])
      for (const i of page.items) seen.set(i.id, i)
  if (parent) for (const i of offlineChildren(account, parent)) if (!seen.has(i.id)) seen.set(i.id, i)
  const items = queueState(account).ops.reduce((all, op) => applyOp(all, path, true, op), [...seen.values()])
  return items.filter((i) => i.kind === "folder").map((i) => ({ id: i.id, name: i.name })).sort((a, b) => a.name.localeCompare(b.name))
}

export function useTags() {
  const api = useApi()
  return useQuery({
    queryKey: [api.id, "tags"],
    queryFn: () => api.get<TagsResponse>("/tags"),
    select: (d) => d.tags,
  })
}

// The bell and the Shared badge. React Query pauses the interval while the app is
// in the background (focusManager in app/_layout.tsx).
export function useCounts() {
  const api = useApi()
  return useQuery({
    queryKey: [api.id, "counts"],
    enabled: !!api.account,
    refetchInterval: 60_000,
    queryFn: () =>
      json<{ unread: number; shared: number }>(api.account.server, "/api/notifications", { token: api.account.token }),
  })
}

export const useShareState = (id: string, enabled = true) => {
  const api = useApi()
  return useQuery({
    queryKey: [api.id, "shares", id],
    enabled,
    retry: false,
    queryFn: () => api.get<ShareState>(`/items/${id}/shares`),
  })
}

export function useAccountData() {
  const api = useApi()
  return useQuery({ queryKey: [api.id, "account"], queryFn: () => api.get<AccountResponse>("/account") })
}

export function useInstance() {
  const api = useApi()
  return useQuery({ queryKey: [api.id, "instance"], queryFn: () => api.get<Instance>("/instance") })
}

export function useVersions(id: string, enabled = true) {
  const api = useApi()
  return useQuery({
    queryKey: [api.id, "versions", id],
    enabled,
    queryFn: () => api.get<VersionsResponse>(`/items/${id}/versions`),
    select: (d) => d.versions,
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
  | { kind: "vault"; items: Item[] }
  | { kind: "new"; parentId: string | null }
  | { kind: "filter"; filter: "type" | "modified" | "size" | "tag" }
  | { kind: "sort" }

// ---- Who may do what: the web's rules, from actions() in components/file-browser.tsx ----

// `context` is the role in the folder being viewed; "owner" everywhere else.
export const roleOf = (item: Item, context: Role = "owner"): Role => item.role ?? context
export const editable = (items: Item[], context?: Role) =>
  items.length > 0 && items.every((i) => roleOf(i, context) !== "viewer" && !i.shortcut)
// The server has the last word: an owner can turn sharing off for editors.
export const shareable = (item: Item, context?: Role) => !item.shortcut && roleOf(item, context) !== "viewer"

export const label = (items: Pick<Item, "name">[]) =>
  items.length === 1 ? `“${items[0].name}”` : `${items.length} items`

// ---- Changing things ----

type Queued = { op: Op; label: string }

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

  // With no connection a plain edit waits in the queue (offline-queue.ts) and shows at once.
  const queueIt = useCallback(
    (q: Queued) => {
      enqueue(api.id, q.op, q.label)
      showOptimistically(client, api.id, q.op)
      snack({ text: "Will sync when online." })
    },
    [client, api.id, snack]
  )
  const dropped = (e: unknown) => e instanceof ApiError && e.status === 0

  const run = useCallback(
    async (task: () => Promise<unknown>, text: string, undo?: () => void, queued?: Queued) => {
      if (queued && !isOnline()) {
        queueIt(queued)
        return true
      }
      try {
        await task()
        refresh()
        snack({ text, undo })
        return true
      } catch (e) {
        if (queued && dropped(e)) {
          queueIt(queued)
          return true
        }
        snack({ text: errorText(e), error: true })
        return false
      }
    },
    [refresh, snack, queueIt]
  )

  // For text fields: the error to show, or nothing when it worked.
  const attempt = useCallback(
    async (task: () => Promise<unknown>, text: string, queued?: Queued) => {
      if (queued && !isOnline()) return queueIt(queued)
      try {
        await task()
        refresh()
        snack({ text })
      } catch (e) {
        if (queued && dropped(e)) return queueIt(queued)
        return errorText(e)
      }
    },
    [refresh, snack, queueIt]
  )

  return useMemo(() => {
    const ids = (items: Item[]) => items.map((i) => i.id)
    const restore = (items: Item[]) =>
      run(() => api.post("/items/restore", { ids: ids(items) }), `Restored ${label(items)}.`, undefined, {
        op: { op: "restore", ids: ids(items) },
        label: `Restore ${label(items)}`,
      })
    return {
      refresh,
      restore,
      star: (items: Item[]) => {
        const on = !items.every((i) => i.starred)
        return run(
          () => api.post("/items/star", { ids: ids(items), starred: on }),
          on ? `Added ${label(items)} to starred.` : `Removed ${label(items)} from starred.`,
          undefined,
          { op: { op: "star", ids: ids(items), starred: on }, label: `${on ? "Star" : "Unstar"} ${label(items)}` }
        )
      },
      trash: (items: Item[]) =>
        run(
          () => api.post("/items/trash", { ids: ids(items) }),
          `Moved ${label(items)} to the trash.`,
          () => restore(items),
          { op: { op: "trash", ids: ids(items) }, label: `Move ${label(items)} to the trash` }
        ),
      remove: (items: Item[]) =>
        run(() => api.post("/items/delete", { ids: ids(items) }), `Deleted ${label(items)} forever.`),
      emptyTrash: () => run(() => api.post("/trash/empty"), "Emptied the trash."),
      move: (items: Item[], parentId: string | null, to: string) =>
        run(() => api.post("/items/move", { ids: ids(items), parentId }), `Moved ${label(items)} to “${to}”.`, undefined, {
          op: { op: "move", ids: ids(items), parentId },
          label: `Move ${label(items)} to “${to}”`,
        }),
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
        attempt(() => api.patch(`/items/${item.id}`, { name }), `Renamed to “${name}”.`, {
          op: { op: "rename", id: item.id, name, folder: item.kind === "folder" },
          label: `Rename “${item.name}” to “${name}”`,
        }),
      newFolder: (parentId: string | null, name: string) =>
        attempt(() => api.post("/folders", { parentId, name }), `Created “${name}”.`, {
          op: { op: "newFolder", parentId, name, tempId: newTempId() },
          label: `Create folder “${name}”`,
        }),

      // Quiet: the tag sheet shows the change as it happens.
      applyTag: async (items: Item[], tagId: string, on: boolean) => {
        const queued: Queued = { op: { op: "applyTag", ids: ids(items), tagId, on }, label: `${on ? "Add" : "Remove"} a tag on ${label(items)}` }
        if (!isOnline()) return queueIt(queued)
        try {
          await api.post("/tags/apply", { ids: ids(items), tagId, on })
          refresh()
        } catch (e) {
          if (dropped(e)) return queueIt(queued)
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
  }, [api, attempt, queueIt, refresh, run, snack])
}

// ---- Links ----

export function useLinks() {
  const api = useApi()
  const actions = useFileActions()
  const snack = useSnack()

  return useMemo(() => {
    const url = (link: LinkInfo) => linkUrl(api.account.server, link)
    const state = (id: string) => api.get<ShareState>(`/items/${id}/shares`)
    // Answers only the id, and the URL's token is in the share state.
    // request: an upload-only link (a file request), folders only.
    const create = async (id: string, password?: string, request?: boolean) => {
      const made = await api.post<CreateLinkResponse>(`/items/${id}/links`, { password, request })
      const link = (await state(id)).links.find((l) => l.id === made.id)
      if (!link) throw new Error("The link was made, but it couldn't be loaded. Try again.")
      actions.refresh()
      return link
    }
    return {
      url,
      create,
      copy: async (link: LinkInfo) => {
        await Clipboard.setStringAsync(url(link))
        snack({ text: `Copied “${link.name}”.` })
      },
      sendTo: (link: LinkInfo) => Share.share({ message: url(link) }).catch(() => {}),
      // ⋯ → Copy link. A server that insists on a password sends you to the Share screen to give one.
      copyFor: async (item: Item) => {
        try {
          const s = await state(item.id)
          // Checked first: with links off, an existing one wouldn't open.
          if (!s.publicLinks) return snack({ text: "Your admin turned public links off.", error: true })
          const have = pickLink(s.links)
          if (have) {
            await Clipboard.setStringAsync(url(have))
            return snack({ text: `Copied “${have.name}”.` })
          }
          if (s.requireLinkPassword) return router.push({ pathname: "/share/[id]", params: { id: item.id, newLink: "1" } })
          const made = await create(item.id)
          await Clipboard.setStringAsync(url(made))
          snack({ text: `Made a new link and copied it.` })
        } catch (e) {
          snack({ text: errorText(e), error: true })
        }
      },
    }
  }, [api, actions, snack])
}

// ---- Better Auth's own endpoints, for account changes ----

// Saves any session token the answer brings, so the next call already uses it.
// `add` replaces this account's entry, and refreshes its name and picture too.
export function useAuthCall() {
  const { active, add } = useAccounts()
  return useCallback(
    async <T = Record<string, unknown>,>(path: string, body: unknown = {}, method = "POST") => {
      const r = await send(active!.server, path, {
        method,
        token: active!.token,
        body: method === "GET" ? undefined : JSON.stringify(body),
      })
      const data = await r.json().catch(() => null)
      if (!r.ok) throw new ApiError(r.status, data?.code ?? data?.error ?? "error", data?.message ?? "Something went wrong. Try again.")
      const token = newToken(r)
      if (token && token !== active!.token) await add(active!.server, token)
      return data as T
    },
    [active, add]
  )
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
