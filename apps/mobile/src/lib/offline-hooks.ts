// Marking items from the screens: the cap question, the folder it came from, and what to tell the person.
import type { Details, Item } from "@nimbus/shared/api"
import { formatBytes } from "@nimbus/shared/file-rules"
import { useQueryClient, type QueryClient } from "@tanstack/react-query"
import { useMemo } from "react"

import { useSnack } from "@/components/snackbar"
import { isOnline } from "./connectivity"
import { useApi } from "./files"
import { getCap, markItems, snapshot, unmark, useOffline } from "./offline"
import { capCheck } from "./offline-rules"

export type CapAsk = { items: Item[]; short: number; cap: number }

// The folder an item was last listed in ("root" for My files), for the Files app's tree.
function parentHint(client: QueryClient, account: string, id: string): string | null {
  for (const q of client.getQueryCache().findAll({ queryKey: [account, "list"] })) {
    const path = String(q.queryKey[2])
    if (path !== "/files" && !path.startsWith("/folders/")) continue
    const pages = (q.state.data as { pages?: { items: Item[] }[] } | undefined)?.pages
    if (pages?.some((p) => p.items.some((i) => i.id === id))) return path === "/files" ? "root" : path.slice("/folders/".length)
  }
  return null
}

export function useOfflineActions() {
  const api = useApi()
  const client = useQueryClient()
  const snack = useSnack()
  const snap = useOffline(api.id)

  return useMemo(() => {
    const name = (items: Item[]) => (items.length === 1 ? `“${items[0].name}”` : `${items.length} items`)

    // What turning it on would add. A folder's size comes from the server when there is one.
    const sizeOf = async (item: Item) => {
      if (item.kind === "file") return item.size
      if (!isOnline()) return 0
      try {
        const got = await api.get<{ details: Details }>(`/items/${item.id}`)
        return got.details?.contents?.bytes ?? 0
      } catch {
        return 0
      }
    }

    // Resolves to the cap question when the items won't fit, so the caller can ask; `force` skips it.
    const set = async (items: Item[], on: boolean, force = false): Promise<CapAsk | undefined> => {
      const now = snapshot(api.id)
      if (!on) {
        const roots = items.filter((i) => now.rootOf.get(i.id) === i.id)
        const inside = items.find((i) => now.covered.has(i.id) && now.rootOf.get(i.id) !== i.id)
        if (roots.length) {
          unmark(api.id, roots.map((i) => i.id))
          snack({ text: `${name(roots)} removed from offline.` })
        } else if (inside) {
          const parent = now.roots.find((r) => r.id === now.rootOf.get(inside.id))
          snack({ text: `“${inside.name}” is kept offline by “${parent?.name ?? "its folder"}”. Remove that to free it.` })
        }
        return
      }
      const todo = items.filter((i) => !now.covered.has(i.id))
      if (!todo.length) return void snack({ text: `${name(items)} already available offline.` })
      if (!force) {
        const adding = (await Promise.all(todo.map(sizeOf))).reduce((n, s) => n + s, 0)
        const cap = getCap()
        const check = capCheck(now.bytes, adding, cap)
        if (check.over) return { items: todo, short: check.short, cap: cap! }
      }
      for (const item of todo) markItems(api.account, [item], parentHint(client, api.id, item.id))
      snack({ text: isOnline() ? `Saving ${name(todo)} for offline.` : `${name(todo)} will download when you're online.` })
    }

    const message = (ask: CapAsk) =>
      `${ask.items.length === 1 ? `“${ask.items[0].name}”` : `${ask.items.length} items`} would take offline storage ${formatBytes(ask.short)} past your ${formatBytes(ask.cap)} limit. Nothing already saved is removed, and you can raise the limit on the Offline screen.`

    return { snap, set, message }
  }, [api, client, snack, snap])
}
