"use client"

import { useState, useTransition } from "react"

import { FormError } from "@/components/two-factor"
import { Button } from "@/components/ui/button"
import { revokeMemberS3Key, setMemberS3 } from "./actions"

type Key = { id: string; name: string; access: "rw" | "ro"; used: string }

// Member page: their S3 switch and access keys, for a lost laptop or a leaked key.
export function MemberS3({
  id,
  on,
  keys,
  editable,
}: {
  id: string
  on: boolean
  keys: Key[]
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
      {keys.length === 0 ? (
        <p className="rounded-xl border border-dashed border-input px-4 py-8 text-center text-sm text-muted-foreground">
          No S3 access keys.
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center gap-3 px-4 py-3">
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate text-sm">
                  {k.name}
                  <span className="text-muted-foreground">
                    {" "}
                    · {k.access === "ro" ? "Read only" : "Read & write"}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">{k.used}</span>
              </span>
              {editable && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => run(() => revokeMemberS3Key(id, k.id))}
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
          onClick={() => run(() => setMemberS3(id, !on))}
        >
          {on ? "Turn S3 off for them" : "Turn S3 back on"}
        </Button>
      )}
      {editable && on && keys.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Turning S3 off also revokes these keys.
        </p>
      )}
      <FormError>{error}</FormError>
    </div>
  )
}
