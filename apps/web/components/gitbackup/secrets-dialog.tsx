"use client"

import { Dialog } from "@base-ui/react/dialog"

import { saveTokenToSecret } from "@/app/(app)/more/github-backup/actions"
import { SaveToSecrets } from "@/components/registry-save-secret"
import { TOUCH } from "@/components/registry-ui"
import { DIALOG_BACKDROP, DIALOG_POPUP } from "@/components/overlay-styles"
import { Button } from "@/components/ui/button"

// Offered once after a token is saved: keep a copy in Secrets too. Dismissable; nothing is saved unless they choose to.
// `save` and `defaultName` let another tool (Registry tools' mirror login) reuse it.
export function SecretsDialog({ token, onClose, save = saveTokenToSecret, defaultName = "GITHUB_BACKUP_TOKEN" }: { token: string | null; onClose: () => void; save?: typeof saveTokenToSecret; defaultName?: string }) {
  return (
    <Dialog.Root open={token !== null} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={DIALOG_POPUP}>
          <div className="grid gap-1.5">
            <Dialog.Title className="text-base font-semibold">Keep a copy in Secrets?</Dialog.Title>
            <Dialog.Description className="text-sm text-pretty text-muted-foreground">
              Nimbus stores this sealed and never shows it again. If you may need it elsewhere, save it to a Secrets project now.
            </Dialog.Description>
          </div>
          {token && <SaveToSecrets token={token} defaultName={defaultName} save={save} />}
          <div className="flex justify-end">
            <Button variant="outline" className={TOUCH} onClick={onClose}>
              Not now
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
