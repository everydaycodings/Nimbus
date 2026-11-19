"use client"

import { Dialog } from "@base-ui/react/dialog"

import { DIALOG_BACKDROP, DIALOG_POPUP } from "@/components/overlay-styles"
import { TOUCH } from "@/components/registry-ui"
import { SubmitButton } from "@/components/submit-button"
import { FormError } from "@/components/two-factor"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// The modal form the lifecycle and CORS rule editors share.
export function RuleDialog({
  title,
  description,
  pending,
  error,
  disabled,
  onSubmit,
  onClose,
  children,
}: {
  title: string
  description: string
  pending: boolean
  error?: string
  disabled?: boolean
  onSubmit: () => void
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <Dialog.Root open onOpenChange={(o) => !o && !pending && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={cn(DIALOG_POPUP, "max-h-[calc(100svh-2rem)] max-w-lg overflow-y-auto")}>
          <div className="grid gap-1.5">
            <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
            <Dialog.Description className="text-sm text-pretty text-muted-foreground">{description}</Dialog.Description>
          </div>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              onSubmit()
            }}
          >
            {children}
            <FormError>{error}</FormError>
            <div className="flex justify-end gap-2">
              <Dialog.Close disabled={pending} render={<Button type="button" variant="outline" className={TOUCH} />}>
                Cancel
              </Dialog.Close>
              <SubmitButton pending={pending} disabled={disabled} className={TOUCH}>
                Save rule
              </SubmitButton>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
