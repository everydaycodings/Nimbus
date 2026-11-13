"use client"

import { AlertDialog } from "@base-ui/react/alert-dialog"
import { useId, useState } from "react"

import { setFaceGrouping } from "@/app/(app)/people-actions"
import { refreshPeople } from "@/components/people"
import { DIALOG_BACKDROP, DIALOG_POPUP } from "@/components/overlay-styles"
import { Button } from "@/components/ui/button"

// The Face grouping switch. Turning it off deletes the face data, so it asks first.
export function FaceGrouping({ initial }: { initial: boolean }) {
  const id = useId()
  const [on, setOn] = useState(initial)
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function set(next: boolean) {
    setBusy(true)
    setError("")
    const r = await setFaceGrouping(next).catch(() => ({ error: "Couldn't change it. Try again." }))
    setBusy(false)
    setAsking(false)
    if ("error" in r && r.error) return setError(r.error)
    setOn(next)
    refreshPeople()
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="flex cursor-pointer items-center gap-3 text-sm">
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={on}
          disabled={busy}
          onChange={(e) => (e.target.checked ? void set(true) : setAsking(true))}
          className="size-4 accent-primary"
        />
        Group faces in my photos into people
      </label>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <AlertDialog.Root open={asking} onOpenChange={setAsking}>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className={DIALOG_BACKDROP} />
          <AlertDialog.Popup className={DIALOG_POPUP}>
            <div className="grid gap-1.5">
              <AlertDialog.Title className="text-base font-semibold">Turn off face grouping?</AlertDialog.Title>
              <AlertDialog.Description className="text-sm text-pretty text-muted-foreground">
                This deletes everything Nimbus learned about faces in your photos: the people, the names you gave
                them, and their face pictures. Your photos stay as they are. If you turn it back on later, Nimbus
                starts over and you will need to name people again.
              </AlertDialog.Description>
            </div>
            <div className="flex justify-end gap-2">
              <AlertDialog.Close render={<Button type="button" variant="outline" />}>Keep it on</AlertDialog.Close>
              <Button variant="destructive" disabled={busy} onClick={() => void set(false)}>
                {busy ? "Deleting…" : "Turn off and delete"}
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  )
}
