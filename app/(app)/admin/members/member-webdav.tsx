"use client"

import { useState, useTransition } from "react"

import { FormError } from "@/components/two-factor"
import { Button } from "@/components/ui/button"
import { revokeMemberAppPassword, setMemberWebdav } from "./actions"

type App = { id: string; name: string; scope: "rw" | "ro"; used: string }

// Member page: their WebDAV switch and app passwords, for a lost device.
export function MemberWebdav({
  id,
  on,
  apps,
  editable,
}: {
  id: string
  on: boolean
  apps: App[]
  editable: boolean
}) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string>()
  const run = (fn: () => Promise<{ error?: string }>) =>
    start(async () => {
      setError(undefined)
      const r = await fn()
      if (r.error) setError(r.error)
    })

  return (
    <div className="flex flex-col gap-3">
      {apps.length === 0 ? (
        <p className="rounded-xl border border-dashed border-input px-4 py-8 text-center text-sm text-muted-foreground">
          No app passwords.
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border">
          {apps.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-4 py-3">
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate text-sm">
                  {a.name}
                  <span className="text-muted-foreground">
                    {" "}
                    · {a.scope === "ro" ? "Read only" : "Read & write"}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">{a.used}</span>
              </span>
              {editable && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => run(() => revokeMemberAppPassword(id, a.id))}
                >
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          disabled={pending}
          onClick={() => run(() => setMemberWebdav(id, !on))}
        >
          {on ? "Turn WebDAV off for them" : "Turn WebDAV back on"}
        </Button>
      )}
      <FormError>{error}</FormError>
    </div>
  )
}
