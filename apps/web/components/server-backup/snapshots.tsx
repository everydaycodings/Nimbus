"use client"

import { Dialog } from "@base-ui/react/dialog"
import { Menu } from "@base-ui/react/menu"
import { ArrowLeftIcon, CopyIcon, DownloadSimpleIcon, FileIcon, FolderIcon, FolderOpenIcon, FolderSimpleIcon, UploadSimpleIcon } from "@phosphor-icons/react"
import { useEffect, useId, useState, useTransition } from "react"

import { browse, commandOf, restoreFiles, restoreSsh } from "@/app/(app)/more/server-backup/actions"
import { Empty } from "@/components/empty-state"
import { MoveDialog, type Place } from "@/components/move-dialog"
import { DIALOG_BACKDROP, DIALOG_POPUP, MENU_ITEM } from "@/components/overlay-styles"
import { Code, LIST, RADIO, RADIO_INPUT, RowMenu, TOUCH, WHEN } from "@/components/registry-ui"
import { SubmitButton } from "@/components/submit-button"
import { useNotice } from "@/components/toaster"
import { FormError } from "@/components/two-factor"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CopyButton } from "@/components/copy-button"
import { formatBytes } from "@/lib/file-rules"
import type { JobView, SnapshotView } from "@/lib/server-backup/jobs"
import type { Child } from "@/lib/server-backup/restore"
import { cn } from "@/lib/utils"
import { sourceLabel } from "./format"

const dl = (id: string, path: string, dir = false) => `/api/server-backup/snapshots/${id}/download?path=${encodeURIComponent(path)}${dir ? "&dir=1" : ""}`

// A snapshot's files, one folder at a time. The first open of a big snapshot reads all of it once; later folders are quick.
function Browse({ snap, onClose, onFiles }: { snap: SnapshotView; onClose: () => void; onFiles: (path: string) => void }) {
  const [dir, setDir] = useState("")
  const [res, setRes] = useState<{ dir: string; entries?: Child[]; error?: string } | null>(null)
  useEffect(() => {
    let live = true
    browse(snap.id, dir).then(
      (r) => live && setRes({ dir, ...("error" in r && r.error ? { error: r.error } : { entries: ("entries" in r && r.entries) || [] }) }),
      () => live && setRes({ dir, error: "Couldn't open this snapshot. Try again." })
    )
    return () => {
      live = false
    }
  }, [snap.id, dir])
  const here = res?.dir === dir ? res : null
  const entries = here?.entries ?? null
  const error = here?.error
  const crumbs = dir ? dir.split("/") : []
  const crumb = "rounded-sm underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" className={TOUCH} onClick={onClose}>
          <ArrowLeftIcon />
          Back
        </Button>
        <p className="min-w-0 flex-1 truncate text-sm font-semibold" suppressHydrationWarning>{sourceLabel(snap.source)} · {WHEN.format(new Date(snap.takenAt))}</p>
      </div>
      <nav aria-label="Path" className="flex flex-wrap items-center gap-1 font-mono text-xs text-muted-foreground">
        <button type="button" className={crumb} onClick={() => setDir("")}>root</button>
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-1">
            /<button type="button" className={crumb} onClick={() => setDir(crumbs.slice(0, i + 1).join("/"))}>{c}</button>
          </span>
        ))}
      </nav>
      {error ? (
        <p role="alert" className="text-sm text-pretty text-destructive">{error}</p>
      ) : entries === null ? (
        <div aria-busy="true" className="grid gap-2">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />)}
          <p className="text-sm text-muted-foreground">Reading the snapshot. A big one can take a minute the first time.</p>
        </div>
      ) : entries.length === 0 ? (
        <Empty icon={FolderOpenIcon} title="Nothing here">This folder is empty in the snapshot.</Empty>
      ) : (
        <ul className="divide-y rounded-lg border">
          {entries.map((e) => (
            <li key={e.path} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              {e.type === "dir" ? <FolderIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" /> : <FileIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
              {e.type === "dir" ? (
                <button type="button" className="min-w-0 flex-1 truncate rounded-sm text-left text-sm outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50" onClick={() => setDir(e.path)} title={e.name}>{e.name}</button>
              ) : (
                <span className="min-w-0 flex-1 truncate text-sm" title={e.name}>{e.name}</span>
              )}
              {e.type === "file" && <span className="text-xs text-muted-foreground tabular-nums">{formatBytes(e.size)}</span>}
              <a href={dl(snap.id, e.path, e.type === "dir")} download className={cn(buttonVariants({ variant: "ghost", size: "sm" }), TOUCH)} aria-label={`${e.type === "dir" ? "Download as zip" : "Download"} ${e.name}`}>
                <DownloadSimpleIcon />
                {e.type === "dir" ? "Zip" : "Download"}
              </a>
              <Button variant="ghost" size="sm" className={TOUCH} onClick={() => onFiles(e.path)} aria-label={`Restore ${e.name} into Files`}>
                <FolderSimpleIcon />
                To Files
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Restore over ssh: another folder on the server, or the original place after typing the server's name.
function SshDialog({ snap, job, onClose }: { snap: SnapshotView | null; job: JobView; onClose: () => void }) {
  const id = useId()
  const setNotice = useNotice()
  const [where, setWhere] = useState<"other" | "original">("other")
  const [target, setTarget] = useState("/restore")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()
  const volume = snap?.source.startsWith("volume:")
  const original = where === "original"
  return (
    <Dialog.Root open={snap !== null} onOpenChange={(o) => !o && !pending && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={DIALOG_POPUP}>
          <div className="grid gap-1.5">
            <Dialog.Title className="text-base font-semibold">Restore to {job.hostLabel}</Dialog.Title>
            <Dialog.Description className="text-sm text-pretty text-muted-foreground">Sends this snapshot to the server over SSH and unpacks it there. Nothing on the server is deleted; files with the same name are overwritten.</Dialog.Description>
          </div>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              setError(undefined)
              start(async () => {
                const r = await restoreSsh(snap!.id, { target: original ? "original" : target, confirmName: confirm })
                if ("error" in r && r.error) return setError(r.error)
                setNotice({ text: `Restored to ${original ? "the original place" : target}.` })
                onClose()
              })
            }}
          >
            <fieldset className="grid gap-2">
              <legend className="sr-only">Where</legend>
              <label className={RADIO}>
                <input type="radio" name={`${id}-w`} className={RADIO_INPUT} checked={!original} onChange={() => setWhere("other")} />
                Another folder
              </label>
              {!job.isSelf || volume ? (
                <label className={RADIO}>
                  <input type="radio" name={`${id}-w`} className={RADIO_INPUT} checked={original} onChange={() => setWhere("original")} />
                  The original place {volume ? "(the volume)" : "(over the same paths)"}
                </label>
              ) : null}
            </fieldset>
            {!original && (
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-t`}>Folder on the server</Label>
                <Input id={`${id}-t`} value={target} onChange={(e) => setTarget(e.target.value)} spellCheck={false} autoComplete="off" className="font-mono pointer-coarse:h-11" />
                <p className="text-sm text-muted-foreground">Made if it doesn&apos;t exist. The files are placed under it as they were on the server.</p>
              </div>
            )}
            {original && (
              <div className="grid gap-1.5 rounded-lg border border-destructive/40 p-3">
                <Label htmlFor={`${id}-c`}>Type <span className="font-mono">{job.hostLabel}</span> to confirm</Label>
                <Input id={`${id}-c`} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" className="pointer-coarse:h-11" />
                <p className="text-sm text-pretty text-muted-foreground">Files in the snapshot replace the ones on the server now.</p>
              </div>
            )}
            <FormError>{error}</FormError>
            <div className="flex justify-end gap-2">
              <Dialog.Close disabled={pending} render={<Button type="button" variant="outline" className={TOUCH} />}>Cancel</Dialog.Close>
              <SubmitButton pending={pending} disabled={original ? confirm !== job.hostLabel : !target.startsWith("/")} className={TOUCH}>Restore</SubmitButton>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// Restore into Files: a new folder under the one the member picks.
function FilesDialog({ target, onClose }: { target: { snap: SnapshotView; path?: string } | null; onClose: () => void }) {
  const setNotice = useNotice()
  const [place, setPlace] = useState<Place>({ id: null, name: "My files" })
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()
  return (
    <>
      <Dialog.Root open={target !== null && !picking} onOpenChange={(o) => !o && !pending && onClose()}>
        <Dialog.Portal>
          <Dialog.Backdrop className={DIALOG_BACKDROP} />
          <Dialog.Popup className={DIALOG_POPUP}>
            <div className="grid gap-1.5">
              <Dialog.Title className="text-base font-semibold">Restore into Files</Dialog.Title>
              <Dialog.Description className="text-sm text-pretty text-muted-foreground">
                {target?.path ? <>Unpacks <span className="font-mono">{target.path}</span></> : "Unpacks the whole snapshot"} into a new folder, so nothing you have is replaced. It uses your storage.
              </Dialog.Description>
            </div>
            <Button type="button" variant="outline" className={cn(TOUCH, "w-full justify-start")} onClick={() => setPicking(true)}>
              <FolderSimpleIcon />
              <span className="truncate">{place.name}</span>
            </Button>
            <FormError>{error}</FormError>
            <div className="flex justify-end gap-2">
              <Dialog.Close disabled={pending} render={<Button type="button" variant="outline" className={TOUCH} />}>Cancel</Dialog.Close>
              <Button
                className={TOUCH}
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    setError(undefined)
                    const r = await restoreFiles(target!.snap.id, { folderId: place.id, path: target?.path })
                    if ("error" in r && r.error) return setError(r.error)
                    setNotice({ text: `Restored ${("files" in r && r.files) || 0} files into Files.` })
                    onClose()
                  })
                }
              >
                {pending ? "Restoring…" : "Restore here"}
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      <MoveDialog open={picking} title="Restore into which folder?" moving={[]} start={[{ id: null, name: "My files" }]} action="Choose this folder" onClose={() => setPicking(false)} onMove={(to) => (setPlace(to), setPicking(false))} />
    </>
  )
}

function CommandDialog({ snap, onClose }: { snap: SnapshotView | null; onClose: () => void }) {
  const [text, setText] = useState<string>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (!snap) return
    let live = true
    commandOf(snap.id).then((r) => live && ("command" in r ? setText(r.command) : setError(r.error)), () => live && setError("Couldn't load the command."))
    return () => {
      live = false
    }
  }, [snap])
  return (
    <Dialog.Root open={snap !== null} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={cn(DIALOG_POPUP, "sm:max-w-2xl")}>
          <div className="grid gap-1.5">
            <Dialog.Title className="text-base font-semibold">Restore with restic</Dialog.Title>
            <Dialog.Description className="text-sm text-pretty text-muted-foreground">Run this on any machine with restic installed. Fill in the two secrets: the storage secret key, and the repository password you saved when you made the job.</Dialog.Description>
          </div>
          {text ? (
            <div className="relative">
              <Code copy>{text}</Code>
              <CopyButton value={text} label="Copy the command" className="absolute top-2 right-2" />
            </div>
          ) : error ? (
            <p role="alert" className="text-sm text-destructive">{error}</p>
          ) : (
            <div aria-hidden className="h-32 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
          )}
          <div className="flex justify-end">
            <Dialog.Close render={<Button variant="outline" className={TOUCH} />}>Close</Dialog.Close>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function Snapshots({ job, snapshots }: { job: JobView; snapshots: SnapshotView[] }) {
  const [openSnap, setOpenSnap] = useState<SnapshotView | null>(null)
  const [ssh, setSsh] = useState<SnapshotView | null>(null)
  const [files, setFiles] = useState<{ snap: SnapshotView; path?: string } | null>(null)
  const [cmd, setCmd] = useState<SnapshotView | null>(null)
  const canSsh = job.hostMode === "ssh"
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-1">
        <h2 className="text-base font-semibold">Snapshots</h2>
        <p className="text-sm text-muted-foreground">Each one is a point in time. Browse it, download a file or folder, or restore it.</p>
      </div>
      {openSnap ? (
        <Browse snap={openSnap} onClose={() => setOpenSnap(null)} onFiles={(path) => setFiles({ snap: openSnap, path })} />
      ) : snapshots.length === 0 ? (
        <Empty icon={FolderOpenIcon} title="No snapshots yet">{job.lastStatus === "failed" ? job.lastError ?? "The last attempt failed." : "They appear here after the first backup finishes."}</Empty>
      ) : (
        <ul className={LIST}>
          {snapshots.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3 sm:px-4">
              <div className="grid min-w-0 flex-1 gap-0.5">
                <span className="text-sm font-medium" suppressHydrationWarning>{WHEN.format(new Date(s.takenAt))}</span>
                <span className="truncate text-xs text-muted-foreground tabular-nums" title={sourceLabel(s.source)}>
                  {sourceLabel(s.source)} · <span className="font-mono">{s.resticId.slice(0, 8)}</span>{s.bytes ? ` · ${formatBytes(s.bytes)}` : ""}{s.addedBytes !== null ? ` · +${formatBytes(s.addedBytes)}` : ""}
                </span>
              </div>
              <Button variant="outline" size="sm" className={TOUCH} onClick={() => setOpenSnap(s)}>
                <FolderOpenIcon />
                Browse
              </Button>
              <RowMenu label={`More for the snapshot of ${WHEN.format(new Date(s.takenAt))}`}>
                {canSsh && (
                  <Menu.Item className={MENU_ITEM} onClick={() => setSsh(s)}>
                    <UploadSimpleIcon />
                    Restore to the server…
                  </Menu.Item>
                )}
                <Menu.Item className={MENU_ITEM} onClick={() => setFiles({ snap: s })}>
                  <FolderSimpleIcon />
                  Restore into Files…
                </Menu.Item>
                <Menu.Item className={MENU_ITEM} onClick={() => setCmd(s)}>
                  <CopyIcon />
                  Restore with restic…
                </Menu.Item>
              </RowMenu>
            </li>
          ))}
        </ul>
      )}
      {snapshots.length >= 500 && <p className="text-sm text-muted-foreground">Showing the newest 500.</p>}
      <SshDialog key={ssh?.id} snap={ssh} job={job} onClose={() => setSsh(null)} />
      <FilesDialog key={`${files?.snap.id}${files?.path}`} target={files} onClose={() => setFiles(null)} />
      <CommandDialog key={cmd?.id} snap={cmd} onClose={() => setCmd(null)} />
    </div>
  )
}
