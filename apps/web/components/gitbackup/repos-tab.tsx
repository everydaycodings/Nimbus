"use client"

import { Menu } from "@base-ui/react/menu"
import { ArrowClockwiseIcon, ClockIcon, GitBranchIcon, LockSimpleIcon, PlusIcon, TrashIcon, WarningIcon } from "@phosphor-icons/react"
import { useState, useTransition } from "react"

import { addRepos, backupNow, removeRepo, setRepoInterval } from "@/app/(app)/more/github-backup/actions"
import { ConfirmDialog } from "@/components/buckets/confirm-dialog"
import { Empty } from "@/components/empty-state"
import { MENU_ITEM } from "@/components/overlay-styles"
import { LIST, RowMenu, TOUCH } from "@/components/registry-ui"
import { SubmitButton } from "@/components/submit-button"
import { useNotice } from "@/components/toaster"
import { FormError } from "@/components/two-factor"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatBytes } from "@/lib/file-rules"
import type { Ref } from "@/lib/gitbackup/connections"
import type { JobView, RepoView } from "@/lib/gitbackup/jobs"
import type { Progress } from "@/lib/gitbackup/runner"
import { ago, every } from "./format"
import { Picker } from "./picker"

function Status({ r, stage }: { r: RepoView; stage?: string }) {
  if (stage) return <Badge variant="secondary">{stage}</Badge>
  if (r.status === "gone")
    return (
      <Badge variant="outline">
        <WarningIcon aria-hidden className="text-warning" />
        Source gone
      </Badge>
    )
  if (r.status === "error") return <Badge variant="outline" className="text-destructive">Failed</Badge>
  if (r.status === "pending") return <Badge variant="outline" className="text-muted-foreground">Waiting</Badge>
  return <Badge variant="outline">Backed up</Badge>
}

function scopeLine(job: JobView) {
  const o = job.autoOwners
  if (o[0] === "*") return `Backing up everything ${job.connection.account ?? "this token"} can see, new repos included.`
  if (o.length) return job.newOnly ? `Backing up the repos you chose, plus new ones from ${o.join(", ")}.` : `Backing up every repo of ${o.join(", ")}, new ones included.`
  return "Backing up the repos you chose."
}

export function ReposTab({ job, repos, connection, progress, kick }: { job: JobView; repos: RepoView[]; connection: Ref; progress: Progress; kick: () => void }) {
  const setNotice = useNotice()
  const [adding, setAdding] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [error, setError] = useState<string>()
  const [interval, setInterval] = useState<RepoView | null>(null)
  const [removing, setRemoving] = useState<RepoView | null>(null)
  const [pending, start] = useTransition()
  const stage = new Map((progress?.repos ?? []).map((p) => [p.repoId, p.stage]))
  const fail = (r: { error?: string }) => (r.error ? (setNotice({ text: r.error, error: true }), true) : false)

  const run = (o: { repoId: string; force?: boolean }, text: string) =>
    start(async () => {
      if (fail(await backupNow(job.id, o))) return
      setNotice({ text })
      kick()
    })

  return (
    <section className="flex flex-col gap-4" aria-labelledby="repos-h">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto grid gap-1">
          <h2 id="repos-h" className="text-base font-semibold">Repos</h2>
          <p className="text-sm text-pretty text-muted-foreground">{scopeLine(job)}</p>
          <p className="text-sm text-muted-foreground tabular-nums">{repos.length} in this job. Removing one keeps its stored snapshots.</p>
        </div>
        {!adding && (
          <Button className={TOUCH} onClick={() => (setAdding(true), setPicked([]), setError(undefined))}>
            <PlusIcon />
            Add repos
          </Button>
        )}
      </div>

      {adding && (
        <form
          className="flex flex-col gap-4 rounded-xl border bg-card p-4"
          onSubmit={(e) => {
            e.preventDefault()
            setError(undefined)
            start(async () => {
              const r = await addRepos(job.id, picked)
              if (r.error) return setError(r.error)
              setAdding(false)
              const n = (r as { added?: number }).added ?? 0
              setNotice({ text: `Added ${n} repo${n === 1 ? "" : "s"}. Backup started` })
              kick()
            })
          }}
        >
          <Picker connection={connection} picked={picked} onPick={setPicked} exclude={repos.map((r) => `${r.owner}/${r.name}`)} />
          <FormError>{error}</FormError>
          <div className="flex gap-2">
            <SubmitButton pending={pending} disabled={!picked.length} className={TOUCH}>
              Add {picked.length || ""} repo{picked.length === 1 ? "" : "s"}
            </SubmitButton>
            <Button type="button" variant="ghost" className={TOUCH} disabled={pending} onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {repos.length === 0 ? (
        <Empty icon={GitBranchIcon} title="No repos yet">
          Add the repos you want backed up.
        </Empty>
      ) : (
        <ul className={LIST}>
          {repos.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-3 py-3 sm:px-4">
              <div className="grid min-w-0 flex-1 gap-1">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="truncate text-sm font-medium" title={`${r.owner}/${r.name}`}>
                    {r.owner}/{r.name}
                  </span>
                  {r.private && <LockSimpleIcon aria-label="Private" className="size-3.5 shrink-0 text-muted-foreground" />}
                  <Status r={r} stage={stage.get(r.id)} />
                  {r.intervalMin && (
                    <Badge variant="secondary">
                      <ClockIcon aria-hidden />
                      Every {every(r.intervalMin)}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground tabular-nums" suppressHydrationWarning>
                  {r.lastBackupAt ? `Backed up ${ago(r.lastBackupAt)}` : "Not backed up yet"} · {r.snapshots} snapshot{r.snapshots === 1 ? "" : "s"}
                  {r.snapshots ? ` · ${formatBytes(r.bytes)}` : ""}
                </p>
                {r.status === "error" && r.lastError && <p className="line-clamp-2 text-xs text-pretty text-destructive" title={r.lastError}>{r.lastError}</p>}
                {r.status === "gone" && <p className="text-xs text-pretty text-muted-foreground">GitHub no longer shows this repo to this token. Checks stopped; snapshots are kept.</p>}
              </div>
              <RowMenu label={`Actions for ${r.owner}/${r.name}`}>
                <Menu.Item className={MENU_ITEM} disabled={r.status === "gone" || stage.has(r.id)} onClick={() => run({ repoId: r.id }, `Backup of ${r.name} started`)}>
                  <ArrowClockwiseIcon />
                  Back up this repo
                </Menu.Item>
                <Menu.Item className={MENU_ITEM} disabled={r.status === "gone" || stage.has(r.id)} onClick={() => run({ repoId: r.id, force: true }, `Snapshot of ${r.name} started`)}>
                  <ArrowClockwiseIcon />
                  Force snapshot
                </Menu.Item>
                <Menu.Item className={MENU_ITEM} onClick={() => setInterval(r)}>
                  <ClockIcon />
                  Set interval…
                </Menu.Item>
                <Menu.Item className={`${MENU_ITEM} text-destructive`} onClick={() => setRemoving(r)}>
                  <TrashIcon className="text-destructive!" />
                  Remove from job
                </Menu.Item>
              </RowMenu>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${removing ? `${removing.owner}/${removing.name}` : "this repo"}?`}
        body={`It is no longer backed up and its history here is cleared. Its snapshots stay in the bucket.${job.autoOwners.length ? " A repo that matches this job's scope is added again on the next check." : ""}`}
        yes="Remove from job"
        pending={pending}
        onClose={() => setRemoving(null)}
        onYes={() =>
          start(async () => {
            const r = removing!
            if (!fail(await removeRepo(r.id))) setNotice({ text: `Removed ${r.name}. Its snapshots are kept in the bucket.` })
            setRemoving(null)
          })
        }
      />
      {interval && <IntervalDialog repo={interval} job={job} onClose={() => setInterval(null)} />}
    </section>
  )
}

// A short inline form for a per-repo interval; blank follows the job.
function IntervalDialog({ repo, job, onClose }: { repo: RepoView; job: JobView; onClose: () => void }) {
  const setNotice = useNotice()
  const [v, setV] = useState(repo.intervalMin ? String(repo.intervalMin) : "")
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()
  return (
    <form
      className="flex flex-col gap-3 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault()
        start(async () => {
          const r = await setRepoInterval(repo.id, v.trim() ? Number(v) : null)
          if (r.error) return setError(r.error)
          setNotice({ text: v.trim() ? `${repo.name} is checked every ${v} minutes.` : `${repo.name} follows the job's schedule.` })
          onClose()
        })
      }}
    >
      <Label htmlFor="repo-interval">Minutes between checks for {repo.owner}/{repo.name}</Label>
      <Input id="repo-interval" type="number" inputMode="numeric" min={1} value={v} onChange={(e) => setV(e.target.value)} placeholder={`Job default: ${job.intervalMin}`} className="w-48 tabular-nums pointer-coarse:h-11" autoFocus />
      <p className="text-sm text-muted-foreground">Leave blank to follow the job&apos;s schedule.</p>
      <FormError>{error}</FormError>
      <div className="flex gap-2">
        <SubmitButton pending={pending} className={TOUCH}>Save</SubmitButton>
        <Button type="button" variant="ghost" className={TOUCH} disabled={pending} onClick={onClose}>Cancel</Button>
      </div>
    </form>
  )
}
