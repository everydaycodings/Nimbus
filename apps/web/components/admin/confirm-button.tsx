"use client"

import { AlertDialog } from "@base-ui/react/alert-dialog"
import { useState } from "react"

import { DIALOG_BACKDROP, DIALOG_POPUP } from "@/components/overlay-styles"
import { SubmitButton } from "@/components/submit-button"
import { Button } from "@/components/ui/button"

// A button that asks first, then runs `action`.
export function ConfirmButton({
  action,
  label,
  title,
  message,
}: {
  action: () => Promise<void>
  label: string
  title: string
  message: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <AlertDialog.Root open={open} onOpenChange={setOpen}>
      <Button variant="outline" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className={DIALOG_BACKDROP} />
        <AlertDialog.Popup className={DIALOG_POPUP}>
          <div className="grid gap-1.5">
            <AlertDialog.Title className="text-base font-semibold">
              {title}
            </AlertDialog.Title>
            <AlertDialog.Description className="text-sm text-pretty text-muted-foreground">
              {message}
            </AlertDialog.Description>
          </div>
          <form
            action={async () => {
              await action()
              setOpen(false)
            }}
            className="flex justify-end gap-2"
          >
            <AlertDialog.Close render={<Button type="button" variant="outline" />}>
              Cancel
            </AlertDialog.Close>
            <SubmitButton>{label}</SubmitButton>
          </form>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
