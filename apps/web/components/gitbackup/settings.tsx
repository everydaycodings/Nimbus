"use client"

import { Dialog } from "@base-ui/react/dialog"
import { useRouter } from "next/navigation"
import { useId, useState, useTransition } from "react"

import { deleteJob, setWebhook, updateJob } from "@/app/(app)/more/github-backup/actions"
import { DIALOG_BACKDROP, DIALOG_POPUP } from "@/components/overlay-styles"
import { RADIO_INPUT, SECTION, Switch, TOUCH } from "@/components/registry-ui"
import { SubmitButton } from "@/components/submit-button"
import { useNotice } from "@/components/toaster"
import { FormError } from "@/components/two-factor"
import { Button } from "@/components/ui/button"
import type { ConnView, Ref, RegistryPick } from "@/lib/gitbackup/connections"
import type { JobView } from "@/lib/gitbackup/jobs"
import type { DestInput } from "@/lib/gitbackup/setup"
import { ConnectionsManager } from "./connections-manager"
import { ConnectStep, refKey } from "./connect-step"
import { DestStep } from "./dest-step"
import { scopeFromJob, ScopeFields, scopeNewOnly, scopeOwners, type Scope } from "./scope"
import { ScheduleFields, type Sched } from "./schedule-fields"

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  const id = useId()
  return (
    <section className={SECTION} aria-labelledby={id}>
      <div className="grid gap-1">
        <h2 id={id} className="text-base font-semibold">{title}</h2>
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">{hint}</p>
      </div>
      {children}
    </section>
  )
}

export function Settings({ job, connections, registry, oauth, min }: { job: JobView; connections: ConnView[]; registry: RegistryPick[]; oauth: boolean; min: number }) {
  const router = useRouter()
  const setNotice = useNotice()
  const [sched, setSched] = useState<Sched>({ name: job.name, prefix: job.prefix, intervalMin: job.intervalMin, keepLast: job.keepLast, lfs: job.lfs })
  const [scope, setScope] = useState<Scope>(() => scopeFromJob(job.autoOwners, job.newOnly))
  const current: Ref = job.connection.kind === "own" ? { connectionId: job.connection.id } : { registryConnectionId: job.connection.id }
  const [conn, setConn] = useState<Ref>(current)
  const [changeDest, setChangeDest] = useState(false)
  const [dest, setDest] = useState<DestInput | null>(null)
  const [error, setError] = useState<string>()
  const [saved, setSaved] = useState(false)
  const [pending, start] = useTransition()
  const [hook, setHook] = useState<{ on: boolean; failed: string[]; error?: string }>({ on: job.webhookEnabled, failed: [] })
  const [hookBusy, hookStart] = useTransition()
  const [deleting, setDeleting] = useState(false)

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-8">
      {/* The token and storage forms below are their own forms, so this one ends before them; Save submits it by id. */}
      <form
        id="gb-job-settings"
        className="flex flex-col gap-8"
        onSubmit={(e) => {
          e.preventDefault()
          setError(undefined)
          setSaved(false)
          start(async () => {
            const r = await updateJob(job.id, {
              ...sched,
              autoOwners: scopeOwners(scope),
              newOnly: scopeNewOnly(scope),
              connection: refKey(conn) === refKey(current) ? undefined : conn,
              dest: changeDest ? (dest ?? undefined) : undefined,
            })
            if (r.error) return setError(r.error)
            setSaved(true)
            setChangeDest(false)
            setNotice({ text: "Saved." })
          })
        }}
      >
        <Section title="Job" hint="The name, schedule and what is kept. Changes apply from the next check.">
          <ScheduleFields value={sched} onChange={setSched} min={min} showName />
        </Section>
        <Section title="What to back up" hint="Everything this token can see, whole accounts or organizations, or just the repos you chose. Wider scopes add their repos at once and pick up new ones on their own.">
          <ScopeFields connection={conn} value={scope} onChange={setScope} picker={false} />
        </Section>
      </form>
        <Section title="GitHub connection" hint="Which token this job uses to read your repos.">
          <ConnectStep connections={connections} registry={registry} oauth={oauth} value={conn} onChange={setConn} />
        </Section>
        <Section title="Storage" hint={job.destKind === "nimbus" ? "Archives go to a bucket on this server." : "Archives go to your own S3 storage."}>
          <p className="rounded-lg border px-3 py-2.5 text-sm">
            <span className="text-muted-foreground">{job.destKind === "nimbus" ? "Nimbus S3 bucket " : "Bucket "}</span>
            <span className="font-mono">{job.bucket}</span>
            {job.destKind === "s3" && <span className="block truncate font-mono text-xs text-muted-foreground" title={job.endpoint}>{job.endpoint}</span>}
          </p>
          {changeDest ? (
            <div className="grid gap-3">
              <p className="text-sm text-pretty text-muted-foreground">New backups go to the new place. Existing snapshots stay where they are and are no longer managed.</p>
              <DestStep onChange={setDest} jobName={sched.name} existing={job.destKind === "s3" ? { endpoint: job.endpoint, region: job.region, bucket: job.bucket, accessKey: job.accessKey, pathStyle: job.pathStyle } : undefined} />
              <Button type="button" variant="ghost" className={`${TOUCH} w-fit`} onClick={() => (setChangeDest(false), setDest(null))}>
                Keep the current storage
              </Button>
            </div>
          ) : (
            <Button type="button" variant="outline" className={`${TOUCH} w-fit`} onClick={() => setChangeDest(true)}>
              Change storage…
            </Button>
          )}
        </Section>
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton form="gb-job-settings" pending={pending} disabled={(changeDest && !dest) || sched.intervalMin < min || (scope.mode === "owners" && !scope.owners.length)} className={TOUCH}>
            Save changes
          </SubmitButton>
          {saved && <p role="status" className="text-sm text-muted-foreground">Saved.</p>}
          <p className="text-sm text-muted-foreground">Saves the job, what to back up, the connection and the storage.</p>
        </div>
        <FormError>{error}</FormError>
      </div>

      <Section title="Push webhook" hint="Back up a repo within moments of a push instead of waiting for the next check. Nimbus adds a webhook to each repo, so the token needs permission to manage hooks.">
        <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 rounded-lg border px-3 py-2.5 text-sm">
          <span className="font-medium">Back up on push</span>
          <Switch
            checked={hook.on}
            disabled={hookBusy}
            onChange={(e) =>
              hookStart(async () => {
                const on = e.target.checked
                const r = await setWebhook(job.id, on)
                if ("error" in r && r.error) return setHook({ ...hook, error: r.error })
                setHook({ on, failed: "failed" in r ? (r.failed ?? []) : [] })
              })
            }
          />
        </label>
        {hook.error && <FormError>{hook.error}</FormError>}
        {hook.failed.length > 0 && (
          <div role="alert" className="grid gap-1 text-sm text-destructive">
            <p>These repos couldn&apos;t get a webhook. They are still backed up on schedule.</p>
            <ul className="list-disc pl-5 text-xs break-words">
              {hook.failed.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section title="Saved tokens" hint="Every GitHub token you added for backups. Keep them current: an expired token stops backups.">
        <ConnectionsManager connections={connections} />
      </Section>

      <Section title="Delete this job" hint="Stops all backups for it. Your repos on GitHub are not touched.">
        <Button variant="outline" className={`${TOUCH} w-fit text-destructive hover:text-destructive`} onClick={() => setDeleting(true)}>
          Delete job…
        </Button>
      </Section>
      <DeleteDialog job={job} open={deleting} onClose={() => setDeleting(false)} onDone={() => router.push("/more/github-backup")} />
    </div>
  )
}

function DeleteDialog({ job, open, onClose, onDone }: { job: JobView; open: boolean; onClose: () => void; onDone: () => void }) {
  const setNotice = useNotice()
  const [purge, setPurge] = useState(false)
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && !pending && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={DIALOG_POPUP}>
          <div className="grid gap-1.5">
            <Dialog.Title className="text-base font-semibold">Delete “{job.name}”?</Dialog.Title>
            <Dialog.Description className="text-sm text-pretty text-muted-foreground">
              {job.repos} repo{job.repos === 1 ? "" : "s"} and {job.snapshots} snapshot record{job.snapshots === 1 ? "" : "s"} are removed from Nimbus.
              {job.destKind === "nimbus" ? " The access key made for this job is revoked; the bucket stays." : ""}
            </Dialog.Description>
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm">
            <input type="checkbox" className={`${RADIO_INPUT} mt-0.5`} checked={purge} onChange={(e) => setPurge(e.target.checked)} />
            <span className="grid gap-0.5">
              <span className="font-medium">Also delete the stored backups</span>
              <span className="text-muted-foreground">Removes every archive from the bucket. This can&apos;t be undone.</span>
            </span>
          </label>
          <FormError>{error}</FormError>
          <div className="flex justify-end gap-2">
            <Dialog.Close disabled={pending} render={<Button variant="outline" className={TOUCH} />}>Cancel</Dialog.Close>
            <Button
              variant="destructive"
              className={TOUCH}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await deleteJob(job.id, purge)
                  if ("error" in r && r.error) return setError(r.error)
                  setNotice({ text: `Deleted “${job.name}”.` })
                  onDone()
                })
              }
            >
              {pending ? "Deleting…" : "Delete job"}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
