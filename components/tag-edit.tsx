"use client"

import { Dialog } from "@base-ui/react/dialog"
import { useState, useTransition } from "react"

import {
  deleteTag,
  mergeTags,
  recolorTag,
  renameTag,
  restoreTag,
  tagCount,
} from "@/app/(app)/file-actions"
import { DIALOG_BACKDROP, DIALOG_POPUP } from "@/components/overlay-styles"
import { SubmitButton } from "@/components/submit-button"
import { useNotice } from "@/components/toaster"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { TagColor } from "@/lib/db/schema"
import { TAG_DOT } from "@/lib/file-types"
import type { Tag } from "@/lib/files"
import { cn } from "@/lib/utils"

// Color swatches as radios named "color", for the new and edit tag dialogs.
export function TagColors({ initial }: { initial: TagColor }) {
  return (
    <fieldset className="flex flex-wrap gap-2">
      <legend className="sr-only">Color</legend>
      {(Object.keys(TAG_DOT) as TagColor[]).map((c) => (
        <label
          key={c}
          className="cursor-pointer rounded-full p-0.5 has-checked:ring-2 has-checked:ring-foreground has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50"
        >
          <input
            type="radio"
            name="color"
            value={c}
            defaultChecked={c === initial}
            className="sr-only"
          />
          <span
            aria-hidden
            className={cn("block size-6 rounded-full", TAG_DOT[c])}
          />
          <span className="sr-only">{c}</span>
        </label>
      ))}
    </fieldset>
  )
}

const items = (n: number) =>
  `${n.toLocaleString()} ${n === 1 ? "item" : "items"}`

// Edit (rename and recolor, merging on a clash) and delete with Undo, for the
// Tags menus and the sidebar. Render `dialogs` once.
export function useTagEditor(tags: Tag[]) {
  const setNotice = useNotice()
  const [pending, start] = useTransition()
  // The tag being edited, merged or deleted. Kept while a dialog animates out.
  const [tag, setTag] = useState<Tag | null>(null)
  const [open, setOpen] = useState<"edit" | "merge" | "delete" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [into, setInto] = useState<Tag | null>(null)
  const [uses, setUses] = useState(0)

  function edit(t: Tag) {
    setTag(t)
    setError(null)
    setOpen("edit")
  }

  function save(name: string, color: TagColor) {
    if (!tag) return
    start(async () => {
      if (name.trim() !== tag.name) {
        const res = await renameTag(tag.id, name)
        if (res.error) return setError(res.error)
        if (res.merge) {
          setInto(tags.find((t) => t.id === res.merge) ?? null)
          return setOpen("merge")
        }
      }
      if (color !== tag.color) {
        const res = await recolorTag(tag.id, color)
        if (res.error) return setError(res.error)
      }
      setOpen(null)
      setNotice({ text: `Saved tag “${name.trim()}”.` })
    })
  }

  function merge() {
    if (!tag || !into) return
    start(async () => {
      const res = await mergeTags(tag.id, into.id)
      setOpen(null)
      setNotice(
        res.error
          ? { text: res.error, error: true }
          : { text: `Merged “${tag.name}” into “${into.name}”.` }
      )
    })
  }

  function remove(t: Tag) {
    start(async () => {
      setUses(await tagCount(t.id))
      setTag(t)
      setOpen("delete")
    })
  }

  function confirmDelete() {
    if (!tag) return
    start(async () => {
      const snap = await deleteTag(tag.id)
      setOpen(null)
      if (!snap) return setNotice({ text: "That tag is gone.", error: true })
      setNotice({
        text: `Deleted tag “${snap.tag.name}”.`,
        undo: () =>
          start(async () => {
            const res = await restoreTag(snap)
            setNotice(
              res.error
                ? { text: res.error, error: true }
                : { text: `Restored tag “${snap.tag.name}”.` }
            )
          }),
      })
    })
  }

  const close = (o: boolean) => !o && !pending && setOpen(null)

  const dialogs = (
    <>
      <Dialog.Root open={open === "edit"} onOpenChange={close}>
        <Dialog.Portal>
          <Dialog.Backdrop className={DIALOG_BACKDROP} />
          <Dialog.Popup className={DIALOG_POPUP}>
            <Dialog.Title className="text-base font-semibold">
              Edit tag
            </Dialog.Title>
            <form
              key={tag?.id}
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                const f = new FormData(e.currentTarget)
                save(String(f.get("name")), f.get("color") as TagColor)
              }}
            >
              <div className="grid gap-2">
                <Input
                  name="name"
                  aria-label="Tag name"
                  defaultValue={tag?.name}
                  autoComplete="off"
                  maxLength={40}
                  aria-invalid={Boolean(error)}
                />
                {error && (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                )}
              </div>
              {tag && <TagColors initial={tag.color} />}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => tag && remove(tag)}
                  className="mr-auto text-destructive hover:text-destructive"
                >
                  Delete tag
                </Button>
                <Dialog.Close
                  disabled={pending}
                  render={<Button variant="outline" />}
                >
                  Cancel
                </Dialog.Close>
                <SubmitButton pending={pending}>Save</SubmitButton>
              </div>
            </form>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={open === "merge"} onOpenChange={close}>
        <Dialog.Portal>
          <Dialog.Backdrop className={DIALOG_BACKDROP} />
          <Dialog.Popup className={DIALOG_POPUP}>
            <div className="grid gap-1.5">
              <Dialog.Title className="text-base font-semibold text-balance">
                Merge “{tag?.name}” into “{into?.name}”?
              </Dialog.Title>
              <Dialog.Description className="text-sm text-muted-foreground">
                You already have a tag called “{into?.name}”. Everything tagged
                “{tag?.name}” gets it instead, and “{tag?.name}” is removed.
              </Dialog.Description>
            </div>
            <div className="flex justify-end gap-2">
              <Dialog.Close
                disabled={pending}
                render={<Button variant="outline" />}
              >
                Cancel
              </Dialog.Close>
              <SubmitButton type="button" pending={pending} onClick={merge}>
                Merge tags
              </SubmitButton>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={open === "delete"} onOpenChange={close}>
        <Dialog.Portal>
          <Dialog.Backdrop className={DIALOG_BACKDROP} />
          <Dialog.Popup className={DIALOG_POPUP}>
            <div className="grid gap-1.5">
              <Dialog.Title className="text-base font-semibold text-balance">
                {uses
                  ? `Remove “${tag?.name}” from ${items(uses)}?`
                  : `Delete “${tag?.name}”?`}
              </Dialog.Title>
              <Dialog.Description className="text-sm text-muted-foreground">
                The tag is deleted. The items themselves stay where they are.
              </Dialog.Description>
            </div>
            <div className="flex justify-end gap-2">
              <Dialog.Close
                disabled={pending}
                render={<Button variant="outline" />}
              >
                Cancel
              </Dialog.Close>
              <SubmitButton
                type="button"
                variant="destructive"
                pending={pending}
                onClick={confirmDelete}
              >
                Delete tag
              </SubmitButton>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )

  return { edit, remove, dialogs }
}
