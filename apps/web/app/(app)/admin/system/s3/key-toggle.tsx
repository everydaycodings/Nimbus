"use client"

import { useState, useTransition } from "react"

import { disableS3Key } from "./actions"
import { useNotice } from "@/components/toaster"
import { FormError } from "@/components/two-factor"
import { Button } from "@/components/ui/button"

// Pauses or resumes any member's key; they are told. Revoke stays the permanent option.
export function KeyToggle({ id, name, disabled }: { id: string; name: string; disabled: boolean }) {
  const setNotice = useNotice()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string>()
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="pointer-coarse:h-11 pointer-coarse:px-4"
        aria-label={`${disabled ? "Enable" : "Disable"} ${name}`}
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(undefined)
            const r = await disableS3Key(id, !disabled)
            if (r.error) return setError(r.error)
            setNotice({ text: disabled ? `Enabled ${name}.` : `Disabled ${name}. The member was told.` })
          })
        }
      >
        {disabled ? "Enable" : "Disable"}
      </Button>
      <FormError>{error}</FormError>
    </>
  )
}
