"use client"

import { useActionState } from "react"

import { changePassword } from "@/app/(app)/account/actions"
import { SubmitButton } from "@/components/submit-button"
import { FormError } from "@/components/two-factor"
import { Input } from "@/components/ui/input"
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
        <Input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="newPassword">New password</Label>
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={10}
          aria-describedby="newPassword-hint"
          required
        />
        <p id="newPassword-hint" className="text-xs text-muted-foreground">
          At least 10 characters.
        </p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="confirm">Confirm new password</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
        />
      </div>
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
