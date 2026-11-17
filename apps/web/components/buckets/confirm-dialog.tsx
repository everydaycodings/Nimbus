"use client"

import { Dialog } from "@base-ui/react/dialog"

import { DIALOG_BACKDROP, DIALOG_POPUP } from "@/components/overlay-styles"
import { FormError } from "@/components/two-factor"
import { Button } from "@/components/ui/button"

// The "are you sure?" a menu item opens, since a menu can't hold the inline Confirm.
export function ConfirmDialog({
  open,
  title,
  body,
  yes,
  pending,
  error,
  onYes,
  onClose,
}: {
  open: boolean
  title: string
  body: string
  yes: string
  pending: boolean
  error?: string
  onYes: () => void
  onClose: () => void
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && !pending && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={DIALOG_POPUP}>
          <div className="grid gap-1.5">
            <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
            <Dialog.Description className="text-sm text-pretty text-muted-foreground">{body}</Dialog.Description>
          </div>
          <FormError>{error}</FormError>
          <div className="flex justify-end gap-2">
            <Dialog.Close disabled={pending} render={<Button variant="outline" />} autoFocus>
              Keep
            </Dialog.Close>
            <Button variant="destructive" disabled={pending} onClick={onYes}>
              {yes}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
