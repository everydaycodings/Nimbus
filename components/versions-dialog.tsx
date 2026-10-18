"use client"

import { Dialog } from "@base-ui/react/dialog"
import { Menu } from "@base-ui/react/menu"
import {
  CopySimpleIcon,
  DotsThreeIcon,
  DownloadSimpleIcon,
  EyeIcon,
  NotePencilIcon,
  PushPinIcon,
  PushPinSlashIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import {
  copyVersion,
  deleteVersion,
  listVersions,
  makeCurrent,
  setVersionKeep,
  setVersionNote,
  type Version,
} from "@/app/(app)/upload-actions"
import {
  DIALOG_BACKDROP,
  DIALOG_POPUP,
  MENU_ITEM,
  MENU_POPUP,
} from "@/components/overlay-styles"
import { useNotice } from "@/components/toaster"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { saveUrl } from "@/components/upload-provider"
import { previewKind } from "@/lib/file-rules"
import { formatBytes } from "@/lib/file-types"
import type { Item } from "@/lib/files"
import { cn } from "@/lib/utils"

const full = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })

type Result = { error?: string; name?: string }

// A file's versions (by number, newest first) and the actions on them.
// Re-fetched when the file changes (a new version bumps updatedAt) and after
// each action.
export function useVersions(item: Item, enabled = true) {
  const router = useRouter()
  const [tick, setTick] = useState(0)
  const key = `${item.id}|${item.updatedAt}|${tick}`
  const [loaded, setLoaded] = useState<{
    key: string
    list: Version[] | null
  } | null>(null)
  // Keeps the previous list on screen while the same file re-fetches.
  const list = loaded?.key.startsWith(`${item.id}|`) ? loaded.list : undefined
  const setNotice = useNotice()
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    let live = true
    listVersions(item.id).then(
      (l) => live && setLoaded({ key, list: l }),
      () => live && setLoaded({ key, list: null })
    )
    return () => {
      live = false
    }
  }, [key, item.id, enabled])

  async function act(id: string, task: () => Promise<Result>, done?: string) {
    setNotice(null)
    setBusy(id)
    const res: Result = await task().catch(() => ({
      error: "Something went wrong. Try again.",
    }))
    setBusy(null)
    if (res.error) {
      setNotice({ text: res.error, error: true })
      return false
    }
    if (res.name) setNotice({ text: `Saved as “${res.name}”.` })
    else if (done) setNotice({ text: done })
    setTick((t) => t + 1)
    router.refresh()
    return true
  }

  const older = (list ?? []).filter((v) => !v.current)
  return {
    list,
    busy,
    olderBytes: older.reduce((n, v) => n + v.size, 0),
    olderCount: older.length,
    makeCurrent: (v: Version) =>
      act(v.id, () => makeCurrent(v.id), `v${v.number} is now current.`),
    remove: (v: Version) =>
      act(v.id, () => deleteVersion(v.id), `Deleted v${v.number}.`),
    note: (v: Version, text: string) =>
      act(
        v.id,
        () => setVersionNote(v.id, text),
        text.trim()
          ? `Saved the note on v${v.number}.`
          : `Removed the note on v${v.number}.`
      ),
    keep: (v: Version, on: boolean) =>
      act(
        v.id,
        () => setVersionKeep(v.id, on),
        on
          ? `v${v.number} will be kept forever.`
          : `v${v.number} is no longer kept forever.`
      ),
    copy: (v: Version) => act(v.id, () => copyVersion(v.id)),
  }
}

type Versions = ReturnType<typeof useVersions>

export function versionSummary(v: Versions) {
  if (!v.list) return null
  const count = `${v.list.length} version${v.list.length === 1 ? "" : "s"}`
  return v.olderCount
    ? `${count}. Older versions use ${formatBytes(v.olderBytes)}.`
    : `${count}.`
}

// Rows with Make current and Download inline, the rest in a ⋯ menu. Notes edit
// and deletes confirm in the row itself.
export function VersionList({
  item,
  versions,
  editable,
  limit,
  onPreview,
}: {
  item: Item
  versions: Versions
  editable: boolean
  limit?: number
  // Opens a version in the previewer.
  onPreview?: (v: Version) => void
}) {
  const { list, busy } = versions
  const [confirming, setConfirming] = useState<string | null>(null)
  const [noting, setNoting] = useState<string | null>(null)

  if (list === undefined)
    return (
      <div className="flex flex-col gap-1" aria-label="Loading versions">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="h-14 animate-pulse rounded-lg bg-muted/50 motion-reduce:animate-none"
          />
        ))}
      </div>
    )
  if (list === null)
    return (
      <p className="text-sm text-muted-foreground">
        Couldn&apos;t load versions.
      </p>
    )

  const newest = list[0]
  const current = list.find((v) => v.current)

  return (
    <div className="flex flex-col gap-2">
      {editable && newest && current && current !== newest && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <span className="flex-1 text-muted-foreground">
            You&apos;re using v{current.number}. v{newest.number} is the newest.
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={busy === newest.id}
            onClick={() => versions.makeCurrent(newest)}
          >
            Use newest
          </Button>
        </div>
      )}
      <ul className="divide-y rounded-xl border bg-card">
        {list.slice(0, limit).map((v) => {
          const label = `v${v.number} from ${full(v.createdAt)}`
          const rowBusy = busy === v.id
          return (
            <li
              key={v.id}
              aria-busy={rowBusy || undefined}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2 pr-2 pl-3 aria-busy:opacity-60"
            >
              <span className="w-8 shrink-0 self-start pt-0.5 font-mono text-xs text-muted-foreground">
                v{v.number}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  {full(v.createdAt)}
                  {v.current && <Badge variant="outline">Current</Badge>}
                  {v.keep && (
                    <PushPinIcon
                      weight="fill"
                      aria-label="Kept forever"
                      className="size-3.5 text-muted-foreground"
                    />
                  )}
                </span>
                <span className="text-xs break-words text-muted-foreground">
                  <span className="tabular-nums">{formatBytes(v.size)}</span>
                  {v.uploadedBy && ` · ${v.uploadedBy}`}
                </span>
                {noting === v.id ? (
                  <form
                    className="mt-1 flex items-center gap-1"
                    onSubmit={(e) => {
                      e.preventDefault()
                      const text = String(
                        new FormData(e.currentTarget).get("note")
                      )
                      versions.note(v, text).then((ok) => ok && setNoting(null))
                    }}
                  >
                    <Input
                      name="note"
                      autoFocus
                      aria-label={`Note for ${label}`}
                      placeholder="Add a note"
                      defaultValue={v.note ?? ""}
                      maxLength={200}
                      autoComplete="off"
                      className="h-7 text-sm"
                      onKeyDown={(e) => e.key === "Escape" && setNoting(null)}
                    />
                    <Button size="sm" type="submit" disabled={rowBusy}>
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      type="button"
                      onClick={() => setNoting(null)}
                    >
                      Cancel
                    </Button>
                  </form>
                ) : (
                  v.note && (
                    <span className="text-sm break-words">{v.note}</span>
                  )
                )}
              </span>
              {confirming === v.id ? (
                <span className="flex items-center gap-1">
                  <span className="pr-1 text-sm">Delete v{v.number}?</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={rowBusy}
                    onClick={() => setConfirming(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={rowBusy}
                    onClick={() =>
                      versions.remove(v).then(() => setConfirming(null))
                    }
                  >
                    Delete
                  </Button>
                </span>
              ) : (
                <span className="flex items-center gap-0.5">
                  {editable && !v.current && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Make ${label} current`}
                      disabled={rowBusy}
                      onClick={() => versions.makeCurrent(v)}
                    >
                      Make current
                    </Button>
                  )}
                  {onPreview && previewKind(v.mime, item.name) && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Preview ${label}`}
                      title="Preview"
                      disabled={rowBusy}
                      onClick={() => onPreview(v)}
                    >
                      <EyeIcon />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Download ${label}`}
                    title="Download"
                    disabled={rowBusy}
                    onClick={() =>
                      saveUrl(`/api/files/${item.id}/download?v=${v.id}`)
                    }
                  >
                    <DownloadSimpleIcon />
                  </Button>
                  {editable && (
                    <Menu.Root>
                      <Menu.Trigger
                        disabled={rowBusy}
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`More for ${label}`}
                          />
                        }
                      >
                        <DotsThreeIcon weight="bold" />
                      </Menu.Trigger>
                      <Menu.Portal>
                        <Menu.Positioner
                          side="bottom"
                          align="end"
                          sideOffset={4}
                        >
                          <Menu.Popup className={cn("w-56", MENU_POPUP)}>
                            <Menu.Item
                              className={MENU_ITEM}
                              onClick={() => versions.copy(v)}
                            >
                              <CopySimpleIcon />
                              Save as separate file
                            </Menu.Item>
                            <Menu.Item
                              className={MENU_ITEM}
                              onClick={() => setNoting(v.id)}
                            >
                              <NotePencilIcon />
                              {v.note ? "Edit note" : "Add note"}
                            </Menu.Item>
                            <Menu.Item
                              className={MENU_ITEM}
                              onClick={() => versions.keep(v, !v.keep)}
                            >
                              {v.keep ? <PushPinSlashIcon /> : <PushPinIcon />}
                              {v.keep ? "Don't keep" : "Keep forever"}
                            </Menu.Item>
                            {!v.current && (
                              <>
                                <Menu.Separator className="-mx-1 my-1 h-px bg-border" />
                                <Menu.Item
                                  className={cn(
                                    MENU_ITEM,
                                    "text-destructive [&_svg]:text-destructive"
                                  )}
                                  onClick={() => setConfirming(v.id)}
                                >
                                  <TrashIcon />
                                  Delete version
                                </Menu.Item>
                              </>
                            )}
                          </Menu.Popup>
                        </Menu.Positioner>
                      </Menu.Portal>
                    </Menu.Root>
                  )}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function VersionsDialog({
  item,
  open,
  editable,
  onClose,
  onPreview,
}: {
  item: Item | null
  open: boolean
  editable: boolean
  onClose: () => void
  onPreview?: (v: Version) => void
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup
          className={cn(
            DIALOG_POPUP,
            "max-h-[85svh] max-w-xl max-sm:inset-0 max-sm:top-0 max-sm:left-0 max-sm:h-svh max-sm:max-h-none max-sm:w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0"
          )}
        >
          {item && (
            <Body
              item={item}
              editable={editable}
              enabled={open}
              onPreview={onPreview}
            />
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Body({
  item,
  editable,
  enabled,
  onPreview,
}: {
  item: Item
  editable: boolean
  enabled: boolean
  onPreview?: (v: Version) => void
}) {
  const versions = useVersions(item, enabled)
  return (
    <>
      <div className="grid gap-1.5">
        <Dialog.Title className="text-base font-semibold break-words">
          Versions of {item.name}
        </Dialog.Title>
        <Dialog.Description className="text-sm text-muted-foreground">
          {versionSummary(versions) ?? "Loading versions…"}
        </Dialog.Description>
      </div>
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        <VersionList
          item={item}
          versions={versions}
          editable={editable}
          onPreview={onPreview}
        />
      </div>
      <div className="flex justify-end">
        <Dialog.Close render={<Button variant="outline" />}>Close</Dialog.Close>
      </div>
    </>
  )
}
