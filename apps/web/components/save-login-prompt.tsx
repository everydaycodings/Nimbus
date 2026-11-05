"use client"

import { Dialog } from "@base-ui/react/dialog"
import { useState, useTransition } from "react"

import { dismissSaveLogin, saveLogin } from "@/app/(app)/actions"
import { DIALOG_BACKDROP, DIALOG_POPUP } from "@/components/overlay-styles"
import { Button } from "@/components/ui/button"
import { UserAvatar } from "@/components/user-avatar"

// Asked once after a fresh sign-in, like Instagram's "Save your login info?".
export function SaveLoginPrompt({
  name,
  image,
  twoFactor,
}: {
  name: string
  image?: string | null
  twoFactor: boolean
}) {
  const [open, setOpen] = useState(true)
  const [pending, start] = useTransition()
  const answer = (save: boolean) =>
    start(async () => {
      await (save ? saveLogin() : dismissSaveLogin())
      setOpen(false)
    })

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => !o && !pending && answer(false)}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={DIALOG_POPUP}>
          <div className="flex items-start gap-3">
            <UserAvatar name={name} image={image} size={40} />
            <div className="grid gap-1.5">
              <Dialog.Title className="text-base font-semibold">
                Save your login info?
              </Dialog.Title>
              <Dialog.Description className="text-sm text-muted-foreground">
                Next time on this browser, pick {name} on the sign-in page
                instead of typing your password
                {twoFactor
                  ? ". You'll still enter your two-factor code."
                  : "."}{" "}
                Skip this on a shared or public computer.
              </Dialog.Description>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => answer(false)}
            >
              Not now
            </Button>
            <Button disabled={pending} onClick={() => answer(true)}>
              Save
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
