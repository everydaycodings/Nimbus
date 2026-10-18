"use client"

import { useActionState } from "react"

import { changePassword } from "@/app/(app)/account/actions"
import { NewPasswordFields, PasswordInput } from "@/components/password-input"
import { SubmitButton } from "@/components/submit-button"
import { FormError } from "@/components/two-factor"
import { Label } from "@/components/ui/label"

export function PasswordForm({
  currentLabel = "Current password",
  submitLabel = "Change password",
}: {
  currentLabel?: string
  submitLabel?: string
}) {
  const [state, action] = useActionState(changePassword, null)
  return (
    <form action={action} className="flex max-w-sm flex-col gap-4">
      <div className="grid gap-2">
        <Label htmlFor="currentPassword">{currentLabel}</Label>
        <PasswordInput
          id="currentPassword"
          name="currentPassword"
          autoComplete="current-password"
          required
        />
      </div>
      <NewPasswordFields name="newPassword" />
      <FormError>{state?.error}</FormError>
      {state?.ok && (
        <p role="status" className="text-sm text-muted-foreground">
          Password changed. Your other devices were signed out.
        </p>
      )}
      <SubmitButton className="self-start">{submitLabel}</SubmitButton>
    </form>
  )
}
