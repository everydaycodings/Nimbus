"use client"

import { useActionState } from "react"

import { resendVerification } from "@/app/(app)/account/actions"
import { SubmitButton } from "@/components/submit-button"
import { FormError } from "@/components/two-factor"

export function ResendVerification({
  variant = "outline",
  label = "Send verification email",
}: {
  variant?: "default" | "outline"
  label?: string
}) {
  const [state, action] = useActionState(resendVerification, null)
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <SubmitButton variant={variant}>
        {state?.ok ? "Send again" : label}
      </SubmitButton>
      {state?.ok && (
        <p role="status" className="text-sm text-muted-foreground">
          Sent. Check your inbox and spam folder.
        </p>
      )}
      <FormError>{state?.error}</FormError>
    </form>
  )
}
