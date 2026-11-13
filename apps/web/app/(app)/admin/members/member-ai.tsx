"use client"

import { useState, useTransition } from "react"

import { FormError } from "@/components/two-factor"
import { Button } from "@/components/ui/button"
import { setMemberAi } from "./actions"

// Member page: let this person use the AI features (when the admin limited them to chosen members).
export function MemberAi({ id, on }: { id: string; on: boolean }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string>()
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(undefined)
            const r = await setMemberAi(id, !on)
            if (r.error) setError(r.error)
          })
        }
      >
        {on ? "Turn AI features off for them" : "Allow AI features for them"}
      </Button>
      <FormError>{error}</FormError>
    </div>
  )
}
