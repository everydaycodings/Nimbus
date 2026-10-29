"use client"

import { Dialog } from "@base-ui/react/dialog"
import { Menu } from "@base-ui/react/menu"
import {
  ArrowSquareOutIcon,
  CaretUpDownIcon,
  CheckIcon,
  PlusIcon,
  ShieldCheckIcon,
  SignOutIcon,
  UserCircleIcon,
  XIcon,
} from "@phosphor-icons/react"
import Link from "next/link"
import { useCallback, useEffect, useState } from "react"

import {
  signOutAccount,
  signOutAll,
  signOutCurrent,
  startAddAccount,
  switchAccount,
} from "@/app/(app)/actions"
import { DIALOG_BACKDROP, DIALOG_POPUP } from "@/components/overlay-styles"
import { useSidebar } from "@/components/sidebar-shell"
import { useNotice } from "@/components/toaster"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useUploads } from "@/components/upload-provider"
import { UserAvatar } from "@/components/user-avatar"
import { ACTIVE_ACCOUNT, NOW_USING, reloadTo } from "@/lib/accounts"
import type { DeviceAccount } from "@/lib/session"

type Props = {
  id: string
  name: string
  email: string
  image?: string | null
  role: string
  admin: boolean
  pending: number
  // Every account signed in on this browser, this one included.
  accounts: DeviceAccount[]
  canAdd: boolean
}

function Identity({
  name,
  email,
  image,
  size,
}: {
  name: string
  email: string
  image?: string | null
  size?: number
}) {
  return (
    <>
      <UserAvatar name={name} image={image} size={size} />
      <span className="grid min-w-0 flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium">{name}</span>
        <span className="truncate text-xs text-muted-foreground">{email}</span>
      </span>
    </>
  )
}

const ITEM =
  "flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-sm outline-none select-none data-highlighted:bg-accent [&_svg]:size-4 [&_svg]:text-muted-foreground"

const firstName = (name: string) => name.split(/\s+/)[0]

function statusLabel(a: DeviceAccount) {
  if (!a.live) return "Sign in again"
  if (a.status === "pending") return "Pending"
  if (a.status === "rejected") return "Declined"
  if (a.passwordTemporary) return "Needs password"
}

// Wherever the account changes, the other tabs follow (see ACTIVE_ACCOUNT).
function storeActive(id: string) {
  try {
    localStorage.setItem(ACTIVE_ACCOUNT, id)
  } catch {}
}

// Switching, adding and signing out reload the page, which stops running
// transfers; `guarded` asks first. Render `dialog` once wherever this is used.
export function useAccountActions() {
  const { busy, leave } = useUploads()
  const setNotice = useNotice()
  const [confirm, setConfirm] = useState<{
    n: number
    title: string
    run: () => Promise<void>
  } | null>(null)

  const guarded = useCallback(
    (title: string, run: () => Promise<void>) => {
      const go = async () => {
        leave()
        await run()
      }
      const n = busy()
      if (n) return setConfirm({ n, title, run: go })
      void go()
    },
    [busy, leave]
  )

  const switchTo = useCallback(
    // `to` is where to land; Files home unless a page asked for itself.
    (a: DeviceAccount, to = "/") =>
      guarded(`Switch to ${a.name}?`, async () => {
        if (!(await switchAccount(a.id))) {
          setNotice({
            text: `${a.name} is signed out. Sign in again.`,
            error: true,
          })
          return reloadTo("/")
        }
        try {
          sessionStorage.setItem(NOW_USING, a.name)
        } catch {}
        reloadTo(to)
      }),
    [guarded, setNotice]
  )

  const add = useCallback(
    async (email?: string) => {
      const r = await startAddAccount()
      if (r.error) return setNotice({ text: r.error, error: true })
      reloadTo(
        email ? `/sign-in?email=${encodeURIComponent(email)}` : "/sign-in"
      )
    },
    [setNotice]
  )

  const dialog = (
    <Dialog.Root
      open={Boolean(confirm)}
      onOpenChange={(o) => !o && setConfirm(null)}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={DIALOG_POPUP}>
          <div className="grid gap-1.5">
            <Dialog.Title className="text-base font-semibold">
              {confirm?.title}
            </Dialog.Title>
            <Dialog.Description className="text-sm text-muted-foreground">
              {confirm?.n === 1
                ? "1 transfer is still running and will stop."
                : `${confirm?.n} transfers are still running and will stop.`}
            </Dialog.Description>
          </div>
          <div className="flex justify-end gap-2">
            <Dialog.Close render={<Button variant="outline" />}>
              Keep going
            </Dialog.Close>
            <Button
              onClick={() => {
                const run = confirm?.run
                setConfirm(null)
                void run?.()
              }}
            >
              Stop and continue
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )

  return { guarded, switchTo, add, dialog, setNotice }
}

// Account section in the sidebar footer: who you are, your other accounts on
// this browser, account settings, sign out.
export function NavUser({
  id,
  role,
  admin,
  pending,
  accounts,
  canAdd,
  ...user
}: Props) {
  const { collapsed } = useSidebar()
  const { guarded, switchTo, add, dialog, setNotice } = useAccountActions()

  const others = accounts.filter((a) => a.id !== id)
  const live = accounts.filter((a) => a.live)
  const otherUnread = others.some((a) => a.live && a.unread > 0)

  useEffect(() => {
    storeActive(id)
    function follow(e: StorageEvent) {
      if (e.key === ACTIVE_ACCOUNT && e.newValue !== id) reloadTo("/")
    }
    window.addEventListener("storage", follow)
    try {
      const now = sessionStorage.getItem(NOW_USING)
      sessionStorage.removeItem(NOW_USING)
      if (now) setNotice({ text: `Now using ${now}` })
    } catch {}
    return () => window.removeEventListener("storage", follow)
  }, [id, setNotice])

  // Ctrl+Shift+1–5 jumps to the nth signed-in account.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const m = /^Digit([1-5])$/.exec(e.code)
      if (!m || !e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey) return
      const a = live[Number(m[1]) - 1]
      if (!a) return
      e.preventDefault()
      if (a.id !== id) switchTo(a)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [live, id, switchTo])

  return (
    <>
      <Menu.Root>
        <Menu.Trigger
          aria-label={
            collapsed
              ? `Account: ${user.name}${otherUnread ? ", other accounts have unread notifications" : ""}`
              : undefined
          }
          className="flex w-full items-center gap-2 rounded-md p-2 transition-colors outline-none group-data-[collapsed=true]/sidebar:p-0 hover:bg-sidebar-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 data-popup-open:bg-sidebar-accent [&>span:not(:first-child)]:group-data-[collapsed=true]/sidebar:hidden [&>svg]:group-data-[collapsed=true]/sidebar:hidden"
        >
          <span className="relative shrink-0">
            <UserAvatar name={user.name} image={user.image} />
            {otherUnread && (
              <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-brand ring-2 ring-sidebar" />
            )}
          </span>
          <span className="grid min-w-0 flex-1 text-left text-sm leading-tight">
            <span className="truncate font-medium">{user.name}</span>
            <span className="truncate text-xs text-muted-foreground">
              {user.email}
            </span>
          </span>
          {otherUnread && (
            <span className="sr-only">
              Your other accounts have unread notifications.
            </span>
          )}
          <CaretUpDownIcon className="size-4 shrink-0 text-muted-foreground" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner
            side={collapsed ? "right" : "top"}
            align={collapsed ? "end" : "start"}
            sideOffset={collapsed ? 12 : 6}
          >
            <Menu.Popup className="w-72 origin-(--transform-origin) rounded-lg border bg-popover p-1 text-popover-foreground shadow-md transition-[opacity,scale] duration-100 outline-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
              <div className="flex items-center gap-2 px-1 py-1.5">
                <Identity {...user} />
                <Badge variant="outline">{role}</Badge>
                {others.length > 0 && (
                  <CheckIcon
                    aria-label="Current account"
                    className="size-4 shrink-0 text-brand"
                  />
                )}
              </div>
              {others.map((a) => {
                const label = statusLabel(a)
                const n = live.findIndex((l) => l.id === a.id)
                return (
                  <div key={a.id} className="group/row flex items-center">
                    <Menu.Item
                      onClick={() => (a.live ? switchTo(a) : add(a.email))}
                      className={`${ITEM} h-auto min-w-0 flex-1 py-1.5 ${a.live ? "" : "opacity-60"}`}
                      aria-keyshortcuts={
                        n >= 0 && n < 5 ? `Control+Shift+${n + 1}` : undefined
                      }
                    >
                      <Identity
                        name={a.name}
                        email={a.email}
                        image={a.image}
                        size={28}
                      />
                      {label ? (
                        <Badge variant="outline">{label}</Badge>
                      ) : (
                        a.unread > 0 && (
                          <Badge className="h-5 min-w-5 rounded-full px-1.5 tabular-nums">
                            {a.unread > 99 ? "99+" : a.unread}
                            <span className="sr-only"> unread</span>
                          </Badge>
                        )
                      )}
                    </Menu.Item>
                    <Menu.Item
                      closeOnClick={false}
                      onClick={async () => {
                        await signOutAccount(a.id)
                        setNotice({
                          text: a.live
                            ? `Signed out of ${a.name}`
                            : `Removed ${a.name} from this browser`,
                        })
                      }}
                      aria-label={
                        a.live ? `Sign out of ${a.name}` : `Forget ${a.name}`
                      }
                      className={`${ITEM} size-8 shrink-0 justify-center px-0 opacity-0 group-hover/row:opacity-100 data-highlighted:opacity-100`}
                    >
                      <XIcon />
                    </Menu.Item>
                  </div>
                )
              })}
              {canAdd && (
                <Menu.Item onClick={() => add()} className={ITEM}>
                  <PlusIcon />
                  Add an existing account
                </Menu.Item>
              )}
              <Menu.Separator className="-mx-1 my-1 h-px bg-border" />
              <Menu.Item render={<Link href="/account" />} className={ITEM}>
                <UserCircleIcon />
                Account and security
              </Menu.Item>
              {admin && (
                <Menu.Item
                  render={<a href="/admin" target="_blank" rel="noopener" />}
                  className={ITEM}
                >
                  <ShieldCheckIcon />
                  Admin
                  {pending > 0 && (
                    <Badge className="ml-auto h-5 min-w-5 rounded-full px-1.5 tabular-nums">
                      {pending}
                      <span className="sr-only"> waiting for approval</span>
                    </Badge>
                  )}
                  <ArrowSquareOutIcon
                    className={pending > 0 ? "" : "ml-auto"}
                  />
                </Menu.Item>
              )}
              <Menu.Separator className="-mx-1 my-1 h-px bg-border" />
              <Menu.Item
                onClick={() =>
                  guarded(`Sign out of ${user.name}?`, async () => {
                    await signOutCurrent()
                    reloadTo("/")
                  })
                }
                className={ITEM}
              >
                <SignOutIcon />
                {live.length > 1
                  ? `Sign out ${firstName(user.name)}`
                  : "Sign out"}
              </Menu.Item>
              {live.length > 1 && (
                <Menu.Item
                  onClick={() =>
                    guarded("Sign out of all accounts?", async () => {
                      await signOutAll()
                      storeActive("")
                      reloadTo("/sign-in")
                    })
                  }
                  className={ITEM}
                >
                  <SignOutIcon />
                  Sign out of all accounts
                </Menu.Item>
              )}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>

      {dialog}
    </>
  )
}
