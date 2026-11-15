"use client"

import { useState, useTransition } from "react"

import { FormError } from "@/components/two-factor"
import { Button } from "@/components/ui/button"
import { revokeMemberRegistryToken, setMemberBuilds, setMemberRegistry } from "./actions"

type Key = { id: string; name: string; access: "pull" | "push" | "delete"; used: string }

// Member page: their registry switch and tokens, for a lost laptop or a leaked token.
export function MemberRegistry({
  id,
  on,
  buildsOn,
  keys,
  editable,
}: {
  id: string
  on: boolean
  // Undefined when this server has no image builds.
  buildsOn?: boolean
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
          No registry tokens.
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
                    · {{ pull: "Pull", push: "Push", delete: "Push + Delete" }[k.access]}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">{k.used}</span>
              </span>
              {editable && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => run(() => revokeMemberRegistryToken(id, k.id))}
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
          onClick={() => run(() => setMemberRegistry(id, !on))}
        >
          {on ? "Turn the registry off for them" : "Turn the registry back on"}
        </Button>
      )}
      {editable && on && buildsOn !== undefined && (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          disabled={pending}
          onClick={() => run(() => setMemberBuilds(id, !buildsOn))}
        >
          {buildsOn ? "Turn image builds off for them" : "Turn image builds back on"}
        </Button>
      )}
      {editable && on && keys.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Turning the registry off also revokes these tokens.
        </p>
      )}
      <FormError>{error}</FormError>
    </div>
  )
}
