"use client"

import { Dialog } from "@base-ui/react/dialog"
import { Menu } from "@base-ui/react/menu"
import { CaretDownIcon, ClockCounterClockwiseIcon, CopyIcon, DownloadSimpleIcon, FolderOpenIcon, UploadSimpleIcon } from "@phosphor-icons/react"
import { useEffect, useId, useState, useTransition } from "react"

import { downloadUrl, pushSnapshot, restoreCommand, snapshotsOf } from "@/app/(app)/more/github-backup/actions"
import { Empty } from "@/components/empty-state"
import { DIALOG_BACKDROP, DIALOG_POPUP, MENU_ITEM } from "@/components/overlay-styles"
import { LIST, RowMenu, SELECT, TOUCH, WHEN } from "@/components/registry-ui"
import { SubmitButton } from "@/components/submit-button"
import { useNotice } from "@/components/toaster"
import { FormError } from "@/components/two-factor"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatBytes } from "@/lib/file-rules"
import type { RepoView, RunView, SnapshotView } from "@/lib/gitbackup/jobs"
import { cn } from "@/lib/utils"
import { Browse } from "./browse"
import { duration } from "./format"

const TRIGGER = { schedule: "Scheduled", manual: "Manual", webhook: "Webhook", first: "First backup" }
const OUTCOME = { skipped: "Unchanged", backed_up: "Backed up", failed: "Failed", gone: "Source gone" }

function RunRow({ run }: { run: RunView }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <li>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-3 text-left outline-none hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset sm:px-4">
        <CaretDownIcon aria-hidden className={cn("size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none", !open && "-rotate-90")} />
        <span className="text-sm font-medium" suppressHydrationWarning>{WHEN.format(new Date(run.startedAt))}</span>
        <Badge variant="outline" className={cn(run.status === "failed" && "text-destructive")}>
          {run.status === "ok" ? "Succeeded" : run.status === "partial" ? "Partly failed" : run.status === "running" ? "Running" : "Failed"}
        </Badge>
        <Badge variant="secondary">{TRIGGER[run.trigger]}{run.force ? " · forced" : ""}</Badge>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {run.checked} checked · {run.changed} changed{run.failed ? ` · ${run.failed} failed` : ""} · {formatBytes(run.bytes)} · {duration(run.startedAt, run.finishedAt)}
        </span>
      </button>
      {open && (
        <ul id={id} className="border-t bg-background/40">
          {run.results.length === 0 && <li className="px-4 py-3 text-sm text-muted-foreground">No repo results were recorded.</li>}
          {run.results.map((r) => (
            <li key={r.repoId || "run"} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2 text-sm">
              <span className={cn("min-w-0 truncate", !r.repo && "text-muted-foreground")} title={r.repo || undefined}>{r.repo || "Whole run"}</span>
              <span className={cn("text-xs", r.outcome === "failed" ? "text-destructive" : "text-muted-foreground")}>{OUTCOME[r.outcome]}</span>
              {r.size ? <span className="text-xs text-muted-foreground tabular-nums">{formatBytes(r.size)}</span> : null}
              {r.error && <span className="w-full text-xs text-pretty text-destructive">{r.error}</span>}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

function PushDialog({ snapshot, onClose }: { snapshot: SnapshotView | null; onClose: () => void }) {
  const id = useId()
  const setNotice = useNotice()
  const [url, setUrl] = useState("")
  const [token, setToken] = useState("")
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()
  return (
    <Dialog.Root open={snapshot !== null} onOpenChange={(o) => !o && !pending && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={DIALOG_POPUP}>
          <div className="grid gap-1.5">
            <Dialog.Title className="text-base font-semibold">Push to a remote</Dialog.Title>
            <Dialog.Description className="text-sm text-pretty text-muted-foreground">Sends every branch and tag of this snapshot to a new, empty repo. Make the empty repo first.</Dialog.Description>
          </div>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              setError(undefined)
              start(async () => {
                const r = await pushSnapshot(snapshot!.id, url, token)
                if (r.error) return setError(r.error)
                setNotice({ text: "Pushed. The remote now has every branch and tag." })
                setUrl("")
                setToken("")
                onClose()
              })
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-u`}>Remote address</Label>
              <Input id={`${id}-u`} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/me/restored.git" autoComplete="off" spellCheck={false} className="font-mono pointer-coarse:h-11" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-t`}>Token (optional)</Label>
              <Input id={`${id}-t`} type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} className="font-mono pointer-coarse:h-11" />
              <p className="text-sm text-muted-foreground">Used once for this push and never saved.</p>
            </div>
            <FormError>{error}</FormError>
            <div className="flex justify-end gap-2">
              <Dialog.Close disabled={pending} render={<Button type="button" variant="outline" className={TOUCH} />}>Cancel</Dialog.Close>
              <SubmitButton pending={pending} disabled={!url.trim()} className={TOUCH}>Push</SubmitButton>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function History({ runs: first, repos }: { runs: RunView[]; repos: RepoView[] }) {
  const id = useId()
  const setNotice = useNotice()
  const runs = first
  const [repoId, setRepoId] = useState(repos.find((r) => r.snapshots > 0)?.id ?? repos[0]?.id ?? "")
  const [snaps, setSnaps] = useState<SnapshotView[] | null>(null)
  const [push, setPush] = useState<SnapshotView | null>(null)
  const [browse, setBrowse] = useState<SnapshotView | null>(null)
  const [, start] = useTransition()
  useEffect(() => {
    if (!repoId) return
    let live = true
    snapshotsOf(repoId).then((s) => live && setSnaps(s), () => live && setSnaps([]))
    return () => {
      live = false
    }
  }, [repoId])
  const repo = repos.find((r) => r.id === repoId)
  const fail = (r: object) => ("error" in r && typeof r.error === "string" ? (setNotice({ text: r.error, error: true }), true) : false)

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3" aria-labelledby={`${id}-runs`}>
        <div className="grid gap-1">
          <h2 id={`${id}-runs`} className="text-base font-semibold">Runs</h2>
          <p className="text-sm text-muted-foreground">Every check of this job, newest first. Open one to see each repo.</p>
        </div>
        {runs.length === 0 ? (
          <Empty icon={ClockCounterClockwiseIcon} title="No runs yet">The first backup shows up here as soon as it starts.</Empty>
        ) : (
          <ul className={LIST}>
            {runs.map((r) => (
              <RunRow key={r.id} run={r} />
            ))}
          </ul>
        )}
        {runs.length >= 30 && <p className="text-sm text-muted-foreground">Showing the latest 30.</p>}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby={`${id}-snaps`}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="mr-auto grid gap-1">
            <h2 id={`${id}-snaps`} className="text-base font-semibold">Snapshots</h2>
            <p className="text-sm text-muted-foreground">Each one is a full copy you can download, browse or push to a new remote.</p>
          </div>
          {repos.length > 0 && (
            <div className="flex items-center gap-2">
              <Label htmlFor={`${id}-repo`} className="text-muted-foreground">Repo</Label>
              <select id={`${id}-repo`} value={repoId} onChange={(e) => (setBrowse(null), setSnaps(null), setRepoId(e.target.value))} className={cn(SELECT, "max-w-56 pointer-coarse:h-11")}>
                {repos.map((r) => (
                  <option key={r.id} value={r.id}>{r.owner}/{r.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>
        {browse ? (
          <Browse snapshotId={browse.id} title={`${repo ? `${repo.owner}/${repo.name}` : ""} · ${WHEN.format(new Date(browse.createdAt))}`} onClose={() => setBrowse(null)} />
        ) : !repo ? (
          <Empty icon={FolderOpenIcon} title="No repos in this job">Add repos on the Repos tab.</Empty>
        ) : snaps === null ? (
          <div aria-busy="true" className="grid gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
            ))}
          </div>
        ) : snaps.length === 0 ? (
          <Empty icon={FolderOpenIcon} title="No snapshots yet">{repo.status === "error" ? repo.lastError ?? "The last attempt failed." : "This repo hasn't been backed up yet."}</Empty>
        ) : (
          <ul className={LIST}>
            {snaps.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3 sm:px-4">
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <span className="text-sm font-medium" suppressHydrationWarning>{WHEN.format(new Date(s.createdAt))}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    <span className="font-mono">{s.sha.slice(0, 7)}</span> · {s.refs} ref{s.refs === 1 ? "" : "s"} · {formatBytes(s.size)}{s.lfs ? " · with LFS" : ""}
                  </span>
                </div>
                <Button variant="outline" size="sm" className={TOUCH} onClick={() => start(async () => { const r = await downloadUrl(s.id); if (!fail(r) && "url" in r) window.location.assign(r.url) })}>
                  <DownloadSimpleIcon />
                  Download
                </Button>
                <RowMenu label={`More for the snapshot of ${WHEN.format(new Date(s.createdAt))}`}>
                  <Menu.Item className={MENU_ITEM} onClick={() => setBrowse(s)}>
                    <FolderOpenIcon />
                    Browse files
                  </Menu.Item>
                  <Menu.Item className={MENU_ITEM} onClick={() => start(async () => { const r = await restoreCommand(s.id); if (fail(r) || !("command" in r)) return; await navigator.clipboard.writeText(r.command).then(() => setNotice({ text: "Restore command copied." }), () => setNotice({ text: "Couldn't copy. Allow clipboard access and try again.", error: true })) })}>
                    <CopyIcon />
                    Copy restore command
                  </Menu.Item>
                  <Menu.Item className={MENU_ITEM} onClick={() => setPush(s)}>
                    <UploadSimpleIcon />
                    Push to remote…
                  </Menu.Item>
                </RowMenu>
              </li>
            ))}
          </ul>
        )}
      </section>
      <PushDialog snapshot={push} onClose={() => setPush(null)} />
    </div>
  )
}
