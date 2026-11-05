"use client"

/* eslint-disable @next/next/no-img-element -- provider avatars come from arbitrary hosts */
import { Dialog } from "@base-ui/react/dialog"
import { CheckIcon, UploadSimpleIcon } from "@phosphor-icons/react"
import { useRef, useState, useTransition } from "react"

import { pickAvatar, uploadAvatar } from "@/app/(app)/account/actions"
import { DIALOG_BACKDROP, DIALOG_POPUP } from "@/components/overlay-styles"
import { Button } from "@/components/ui/button"
import { UserAvatar } from "@/components/user-avatar"
import { PRESETS } from "@/lib/avatars"
import { cn } from "@/lib/utils"

const SIZE = 256

// Center-crops to a square and shrinks to 256px. JPEG because Safari can't
// encode WebP from a canvas.
async function squareJpeg(file: File) {
  const img = await createImageBitmap(file)
  const side = Math.min(img.width, img.height)
  const c = document.createElement("canvas")
  c.width = c.height = SIZE
  c.getContext("2d")!.drawImage(
    img,
    (img.width - side) / 2,
    (img.height - side) / 2,
    side,
    side,
    0,
    0,
    SIZE,
    SIZE
  )
  img.close()
  return new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", 0.85))
}

const TILE =
  "relative grid aspect-square place-items-center rounded-full outline-none ring-offset-2 ring-offset-popover focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"

export function AvatarPicker({
  name,
  image,
  providerImage,
}: {
  name: string
  image?: string | null
  providerImage?: string | null
}) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)

  const choose = (choice: string) =>
    start(async () => {
      await pickAvatar(choice)
      setOpen(false)
    })

  const upload = (file: File) =>
    start(async () => {
      setError(undefined)
      const blob = await squareJpeg(file).catch(() => null)
      if (!blob) return setError("That image couldn't be read.")
      const form = new FormData()
      form.set("file", blob, "avatar.jpg")
      const r = await uploadAvatar(form)
      if (r?.error) return setError(r.error)
      setOpen(false)
    })

  const options = [
    ...(providerImage ? [{ value: "provider", src: providerImage }] : []),
    ...PRESETS.map((p) => ({ value: p, src: p })),
  ]

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (pending) return
        setOpen(o)
        setError(undefined)
      }}
    >
      <Dialog.Trigger
        aria-label="Change avatar"
        className="group relative shrink-0 rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <UserAvatar name={name} image={image} size={40} />
        <span className="absolute inset-0 grid place-items-center rounded-full bg-black/55 text-[10px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          Edit
        </span>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={DIALOG_POPUP}>
          <div className="grid gap-1.5">
            <Dialog.Title className="text-base font-semibold">
              Choose an avatar
            </Dialog.Title>
            <Dialog.Description className="text-sm text-muted-foreground">
              Shown next to your name in Nimbus, to you and the people you share
              with.
            </Dialog.Description>
          </div>
          <div className="-mx-2 grid max-h-[min(26rem,55vh)] grid-cols-4 gap-3 overflow-y-auto p-2 sm:grid-cols-6">
            {options.map((o) => {
              const current = o.src === image
              return (
                <button
                  key={o.value}
                  type="button"
                  disabled={pending}
                  onClick={() => !current && choose(o.value)}
                  aria-pressed={current}
                  aria-label={
                    o.value === "provider"
                      ? "Your Google or GitHub photo"
                      : undefined
                  }
                  className={cn(TILE, current && "ring-2 ring-brand")}
                >
                  <img
                    src={o.src}
                    alt={o.value === "provider" ? "" : "Preset avatar"}
                    className="size-full rounded-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                  {current && (
                    <span className="absolute right-0 bottom-0 grid size-5 place-items-center rounded-full bg-brand text-black">
                      <CheckIcon weight="bold" className="size-3" />
                    </span>
                  )}
                </button>
              )
            })}
            <button
              type="button"
              disabled={pending}
              onClick={() => fileRef.current?.click()}
              className={cn(
                TILE,
                "border border-dashed text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <span className="grid justify-items-center gap-0.5 text-[11px]">
                <UploadSimpleIcon className="size-5" />
                Upload
              </span>
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ""
              if (f) upload(f)
            }}
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {pending ? "Saving…" : "Photos are cropped to a square."}
            </p>
            <Dialog.Close
              render={<Button variant="outline" />}
              disabled={pending}
            >
              Close
            </Dialog.Close>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
