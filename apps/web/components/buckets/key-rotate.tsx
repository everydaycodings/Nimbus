"use client"

import { Dialog } from "@base-ui/react/dialog"
import { useState, useTransition } from "react"

import { rotateKey } from "@/app/(app)/buckets/actions"
import type { Made } from "@/components/buckets/key-dialog"
import { DIALOG_BACKDROP, DIALOG_POPUP } from "@/components/overlay-styles"
import { Segmented, TOUCH } from "@/components/registry-ui"
import { SubmitButton } from "@/components/submit-button"
import { FormError } from "@/components/two-factor"
import { Button } from "@/components/ui/button"
import type { KeyRow } from "@/lib/s3api/manage"

const GRACE = [
  ["0", "Now"],
  ["3600", "1 hour"],
  ["86400", "24 hours"],
  ["604800", "7 days"],
] as const

// Asks how long the old secret keeps working, then makes the new one.
export function RotateDialog({
  k,
  open,
  onClose,
  onRotated,
}: {
  k: KeyRow | null
  open: boolean
  onClose: () => void
  onRotated: (m: Made) => void
}) {
  const [grace, setGrace] = useState<(typeof GRACE)[number][0]>("86400")
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && !pending && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={DIALOG_POPUP}>
          <div className="grid gap-1.5">
            <Dialog.Title className="text-base font-semibold">Rotate the secret of “{k?.name}”?</Dialog.Title>
            <Dialog.Description className="text-sm text-pretty text-muted-foreground">
              The key ID stays the same and it gets a new secret. Give your apps time to switch: the old secret keeps
              working for the time you pick, then stops.
            </Dialog.Description>
          </div>
          <div className="grid gap-2">
            <span className="text-sm font-medium">
              Old secret keeps working for
            </span>
            <Segmented label="Old secret keeps working for" value={grace} options={GRACE} onChange={setGrace} disabled={pending} />
            <p className="text-xs text-pretty text-muted-foreground">
              {grace === "0" ? "Apps using the old secret fail at once. Pick this if you think it leaked." : "Both secrets sign requests until then."}
            </p>
          </div>
          <FormError>{error}</FormError>
          <div className="flex justify-end gap-2">
            <Dialog.Close disabled={pending} render={<Button variant="outline" className={TOUCH} />}>
              Cancel
            </Dialog.Close>
            <SubmitButton
              pending={pending}
              className={TOUCH}
              onClick={() => {
                setError(undefined)
                start(async () => {
                  const r = await rotateKey(k!.id, Number(grace))
                  if (r.error || !r.secret) return setError(r.error ?? "Couldn't rotate the key.")
                  onRotated({ accessKeyId: r.accessKeyId!, secret: r.secret, name: k!.name, bucket: k!.buckets[0] ?? null })
                })
              }}
            >
              Rotate secret
            </SubmitButton>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
