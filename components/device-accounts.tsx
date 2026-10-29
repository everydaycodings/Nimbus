"use client"

import { PlusIcon, SignOutIcon } from "@phosphor-icons/react"
import { useTransition } from "react"

import {
  forgetSaved,
  signOutAccount,
  signOutEverywhere,
} from "@/app/(app)/actions"
import { useAccountActions } from "@/components/nav-user"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { UserAvatar } from "@/components/user-avatar"
import { reloadTo } from "@/lib/accounts"
import type { DeviceAccount } from "@/lib/session"

// Account page: every account signed in on this browser, with the same
// actions as the account menu, plus signing this account out everywhere.
export function DeviceAccounts({
  meId,
  accounts,
  canAdd,
}: {
  meId: string
  accounts: DeviceAccount[]
  canAdd: boolean
}) {
  const { guarded, switchTo, add, dialog, setNotice } = useAccountActions()
  const [pending, start] = useTransition()

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col divide-y rounded-lg border">
        {accounts.map((a) => {
          const me = a.id === meId
          return (
            <li key={a.id} className="flex items-center gap-3 p-3">
              <span className={a.live ? "contents" : "contents opacity-60"}>
                <UserAvatar name={a.name} image={a.image} />
                <span className="grid min-w-0 flex-1 text-sm leading-tight">
                  <span className="truncate font-medium">{a.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {a.email}
                  </span>
                  {a.savedId && (
                    <span className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
                      Login info saved here ·
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          start(async () => {
                            await forgetSaved(a.savedId!)
                            setNotice({
                              text: `This browser forgot ${a.name}'s login info`,
                            })
                          })
                        }
                        className="underline-offset-4 hover:text-foreground hover:underline"
                      >
                        Forget
                      </button>
                    </span>
                  )}
                </span>
              </span>
              {me ? (
                <Badge variant="outline">In use</Badge>
              ) : (
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => (a.live ? switchTo(a) : add(a.email))}
                  >
                    {a.live ? "Switch" : "Sign in again"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        await signOutAccount(a.id)
                        setNotice({
                          text: a.live
                            ? `Signed out of ${a.name}`
                            : `Removed ${a.name} from this browser`,
                        })
                      })
                    }
                  >
                    {a.live ? "Sign out" : "Remove"}
                  </Button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <div className="flex flex-wrap gap-2">
        {canAdd && (
          <Button variant="outline" onClick={() => add()}>
            <PlusIcon />
            Add an existing account
          </Button>
        )}
        <Button
          variant="outline"
          onClick={() =>
            guarded("Sign out everywhere?", async () => {
              await signOutEverywhere()
              reloadTo("/")
            })
          }
        >
          <SignOutIcon />
          Sign out everywhere
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Sign out everywhere ends this account on every device and browser,
        including this one. Your other accounts here stay signed in.
      </p>
      {dialog}
    </div>
  )
}
