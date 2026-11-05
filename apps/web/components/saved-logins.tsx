"use client"

import { XIcon } from "@phosphor-icons/react"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import { forgetSaved, signInSaved } from "@/app/(app)/actions"
import { UserAvatar } from "@/components/user-avatar"
import { reloadTo } from "@/lib/accounts"

type Saved = { id: string; name: string; email: string; image: string | null }

// Sign-in page: accounts whose login info is saved on this browser, one tap each.
export function SavedLogins({ accounts }: { accounts: Saved[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string>()
  // Hidden at once on failure; the server clears its cookie too.
  const [dead, setDead] = useState<string[]>([])
  const shown = accounts.filter((a) => !dead.includes(a.id))
  if (!shown.length && !error) return null

  const go = (a: Saved) =>
    start(async () => {
      setError(undefined)
      const r = await signInSaved(a.id)
      if (r.error) {
        setDead((d) => [...d, a.id])
        return setError(r.error)
      }
      if (r.twoFactor) return router.push("/two-factor")
      reloadTo("/")
    })

  return (
    <div className="flex flex-col gap-2">
      {shown.length > 0 && (
        <>
          <p className="text-sm font-medium">Continue as</p>
          <ul className="flex flex-col divide-y rounded-lg border">
            {shown.map((a) => (
              <li key={a.id} className="group flex items-center">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => go(a)}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-3 text-left outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60"
                >
                  <UserAvatar name={a.name} image={a.image} />
                  <span className="grid min-w-0 text-sm leading-tight">
                    <span className="truncate font-medium">{a.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {a.email}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  disabled={pending}
                  aria-label={`Remove ${a.name} from this browser`}
                  onClick={() =>
                    start(async () => {
                      await forgetSaved(a.id)
                      router.refresh()
                    })
                  }
                  className="mr-2 grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 outline-none group-hover:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <XIcon className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3 pt-2 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or use another account
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  )
}
