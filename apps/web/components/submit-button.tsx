"use client"

import { CircleNotchIcon } from "@phosphor-icons/react"
import { useFormStatus } from "react-dom"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// A form's submit button that shows the form is working until the action settles.
export function SubmitButton({
  children,
  pending: forced,
  disabled,
  className,
  onClick,
  ...props
}: React.ComponentProps<typeof Button> & { pending?: boolean }) {
  const { pending } = useFormStatus()
  const busy = pending || forced
  return (
    <Button
      type="submit"
      disabled={disabled}
      aria-disabled={busy || undefined}
      aria-busy={busy}
      className={cn("aria-disabled:pointer-events-none aria-disabled:opacity-50", className)}
      // aria-disabled instead of disabled while pending, so the focused button keeps focus.
      onClick={(e) => (busy ? e.preventDefault() : onClick?.(e))}
      {...props}
    >
      {busy && (
        <CircleNotchIcon className="animate-spin motion-reduce:animate-none" />
      )}
      {children}
    </Button>
  )
}
