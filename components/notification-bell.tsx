"use client"

import { Popover } from "@base-ui/react/popover"
import { BellIcon, CircleNotchIcon } from "@phosphor-icons/react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState, useSyncExternalStore, useTransition } from "react"

import {
  getNotifications,
  markRead,
  markSharedSeen,
} from "@/app/(app)/notification-actions"
import { answerOwnership } from "@/app/(app)/share-actions"
import { MENU_POPUP } from "@/components/overlay-styles"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { Notification } from "@/lib/notify"
import { cn } from "@/lib/utils"

type Counts = { unread: number; shared: number }

// One poll for the bell and the Shared with me badge: on focus and every 60 s.
let counts: Counts = { unread: 0, shared: 0 }
const subs = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | undefined

async function poll() {
  if (document.visibilityState === "hidden") return
  try {
    const res = await fetch("/api/notifications", { cache: "no-store" })
    if (!res.ok) return
    const next: Counts = await res.json()
    if (next.unread === counts.unread && next.shared === counts.shared) return
    counts = next
    subs.forEach((f) => f())
  } catch {}
}

function subscribe(f: () => void) {
  subs.add(f)
  if (subs.size === 1) {
    timer = setInterval(poll, 60_000)
    window.addEventListener("focus", poll)
  }
  return () => {
    subs.delete(f)
    if (!subs.size) {
      clearInterval(timer)
      window.removeEventListener("focus", poll)
    }
  }
}

// The server's counts seed the store once per page load.
let seeded = false
function useCounts(initial: Counts) {
  useEffect(() => {
    if (seeded) return
    seeded = true
    counts = initial
  }, [initial])
  return useSyncExternalStore(
    subscribe,
    () => (seeded ? counts : initial),
    () => initial
  )
}

const ago = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })
function since(iso: string) {
  const s = (Date.parse(iso) - Date.now()) / 1000
  for (const [unit, n] of [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ] as const)
    if (Math.abs(s) >= n) return ago.format(Math.round(s / n), unit)
  return "just now"
}

export function NotificationBell({ initial }: { initial: Counts }) {
  const { unread } = useCounts(initial)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Notification[] | null>(null)
  const [pending, start] = useTransition()
  const router = useRouter()

  function load() {
    getNotifications().then(setItems)
  }

  function onOpenChange(o: boolean) {
    setOpen(o)
    if (o) load()
    // Opening the list counts as seeing it.
    else if (unread)
      markRead().then(() => {
        counts = { unread: 0, shared: 0 }
        subs.forEach((f) => f())
      })
  }

  function answer(n: Notification, accept: boolean) {
    start(async () => {
      await answerOwnership(n.nodeId!, accept)
      load()
      router.refresh()
    })
  }

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={
              unread ? `Notifications, ${unread} unread` : "Notifications"
            }
            className="relative"
          />
        }
      >
        <BellIcon />
        {unread > 0 && (
          <span
            aria-hidden
            className="absolute top-1 right-1 size-2 rounded-full bg-brand ring-2 ring-background"
          />
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6}>
          <Popover.Popup
            className={cn(
              MENU_POPUP,
              "flex max-h-[min(32rem,calc(100svh-5rem))] w-[min(24rem,calc(100vw-1rem))] flex-col p-0"
            )}
          >
            <div className="flex items-center gap-2 border-b px-4 py-3">
              <Popover.Title className="flex-1 text-sm font-semibold">
                Notifications
              </Popover.Title>
              {pending && (
                <CircleNotchIcon className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" />
              )}
            </div>
            {items === null ? (
              <p className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
                <CircleNotchIcon className="size-4 animate-spin motion-reduce:animate-none" />
                Loading…
              </p>
            ) : items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                Nothing new. Shares, file drops and edits in your shared
                folders show up here.
              </p>
            ) : (
              <ul className="flex flex-col overflow-y-auto py-1">
                {items.map((n) => (
                  <li key={n.id} className="relative">
                    <Link
                      href={n.href}
                      onClick={() => setOpen(false)}
                      className="flex gap-3 px-4 py-2.5 text-sm outline-none hover:bg-accent focus-visible:bg-accent"
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "mt-1.5 size-2 shrink-0 rounded-full",
                          n.read ? "bg-transparent" : "bg-brand"
                        )}
                      />
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className={cn(n.read && "text-muted-foreground")}>
                          {n.text}
                          {!n.read && <span className="sr-only"> (new)</span>}
                        </span>
                        <span
                          suppressHydrationWarning
                          className="text-xs text-muted-foreground"
                        >
                          {since(n.createdAt)}
                        </span>
                      </span>
                    </Link>
                    {n.pending && (
                      <div className="flex gap-2 px-4 pb-2.5 pl-9">
                        <Button
                          size="sm"
                          disabled={pending}
                          onClick={() => answer(n, true)}
                        >
                          Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => answer(n, false)}
                        >
                          Decline
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

// New shares, on the Shared with me link. Visiting that page clears it.
export function SharedBadge({ initial }: { initial: Counts }) {
  const { shared } = useCounts(initial)
  const path = usePathname()
  useEffect(() => {
    if (path !== "/shared" || !shared) return
    markSharedSeen().then(() => {
      counts = { unread: Math.max(0, counts.unread - shared), shared: 0 }
      subs.forEach((f) => f())
    })
  }, [path, shared])
  if (!shared || path === "/shared") return null
  return (
    <Badge className="h-5 min-w-5 rounded-full px-1.5 tabular-nums group-data-[collapsed=true]/sidebar:absolute group-data-[collapsed=true]/sidebar:top-1 group-data-[collapsed=true]/sidebar:right-1 group-data-[collapsed=true]/sidebar:h-2 group-data-[collapsed=true]/sidebar:min-w-2 group-data-[collapsed=true]/sidebar:p-0 group-data-[collapsed=true]/sidebar:text-[0px]">
      {shared}
      <span className="sr-only"> new</span>
    </Badge>
  )
}
