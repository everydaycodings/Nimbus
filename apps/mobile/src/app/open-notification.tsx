import type { Item, NotificationKind } from "@nimbus/shared/api"
import { router, useLocalSearchParams, type Href } from "expo-router"
import { useEffect, useRef } from "react"
import { Linking } from "react-native"

import { useSnack } from "@/components/snackbar"
import { Spinner } from "@/components/ui"
import { useAccounts } from "@/lib/accounts"
import { json } from "@/lib/api"
import { notificationTarget } from "@/lib/notifications"
import { openPreview } from "@/lib/preview-session"
import { folderHref } from "@/lib/tab"

// Where tapping an Android notification lands: nimbus://open-notification?account=…&kind=…&href=…&node=…
// (built by Push.kt; widgets and share-sheet folders use it too, with kind=widget). Switches to that account, then goes where the bell would.
export default function OpenNotification() {
  const p = useLocalSearchParams<{ account?: string; kind?: string; href?: string; node?: string }>()
  const { accounts, ready, switchTo } = useAccounts()
  const snack = useSnack()
  const started = useRef(false)

  useEffect(() => {
    if (!ready || started.current) return
    started.current = true
    const account = accounts.find((a) => a.id === p.account)
    if (!account) {
      snack({ text: "That was for an account that's no longer on this phone." })
      return void router.replace("/")
    }
    ;(async () => {
      await switchTo(account.id)
      router.replace("/home")
      // The daily On this day notice (Memories.kt) isn't a server notification: href is the date it was made for.
      if (p.kind === "memories") return router.push({ pathname: "/slideshow", params: { memories: p.href } })
      const target = notificationTarget({ kind: (p.kind ?? "shared") as NotificationKind, href: p.href ?? "", nodeId: p.node || null })
      if (target.to === "browser") return Linking.openURL(account.server + target.path)
      if (target.to === "album") return router.push({ pathname: "/albums/[id]", params: { id: target.id } })
      if (target.to === "route") return router.push(target.path as Href)
      try {
        const { item } = await json<{ item: Item | null }>(account.server, `/api/v1/items/${target.id}`, { token: account.token })
        if (!item || item.trashedAt) return snack({ text: "This is gone, or you can't see it any more." })
        if (item.kind === "folder") router.push({ pathname: folderHref(item.role ? "(shared)" : "(files)", item.id), params: { name: item.name } })
        else {
          openPreview({ items: [item], index: 0, role: item.role ?? "owner" })
          if (target.comments) router.push({ pathname: "/comments/[id]", params: { id: item.id, name: item.name } })
        }
      } catch {
        snack({ text: "This is gone, or you can't see it any more." })
      }
    })()
  }, [ready, accounts, p, switchTo, snack])

  return <Spinner />
}
