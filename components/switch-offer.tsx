"use client"

import { UsersIcon } from "@phosphor-icons/react"

import { useAccountActions } from "@/components/nav-user"
import { Button } from "@/components/ui/button"
import { UserAvatar } from "@/components/user-avatar"
import type { DeviceAccount } from "@/lib/session"

// A folder this account can't open, but another account on this browser can.
export function SwitchOffer({ account }: { account: DeviceAccount }) {
  const { switchTo, dialog } = useAccountActions()
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <span className="grid size-10 place-items-center rounded-lg bg-muted">
          <UsersIcon className="size-5 text-muted-foreground" />
        </span>
        <div className="grid gap-1.5">
          <h1 className="text-lg font-semibold text-balance">
            This was shared with {account.name}
          </h1>
          <p className="text-sm text-balance text-muted-foreground">
            You&apos;re using a different account. {account.name} is also
            signed in on this browser.
          </p>
        </div>
        <Button onClick={() => switchTo(account, location.pathname)}>
          <UserAvatar name={account.name} image={account.image} size={20} />
          Switch to {account.name}
        </Button>
      </div>
      {dialog}
    </div>
  )
}
