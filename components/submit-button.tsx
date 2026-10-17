"use client"

import { CircleNotchIcon } from "@phosphor-icons/react"
import { useFormStatus } from "react-dom"

import { Button } from "@/components/ui/button"

// A form's submit button that shows the form is working until the action settles.
export function SubmitButton({
  children,
  pending: forced,
  disabled,
  ...props
}: React.ComponentProps<typeof Button> & { pending?: boolean }) {
  const { pending } = useFormStatus()
  const busy = pending || forced
  return (
    <Button
      type="submit"
      disabled={busy || disabled}
      aria-busy={busy}
      {...props}
    >
      {busy && (
        <CircleNotchIcon className="animate-spin motion-reduce:animate-none" />
      )}
      {children}
    </Button>
  )
}
