"use client"

import { Dialog } from "@base-ui/react/dialog"
import { useRouter } from "next/navigation"
import { useId, useState, useTransition } from "react"

import { deleteJob, nimbusOptions, testS3, updateJob } from "@/app/(app)/more/server-backup/actions"
import { DestStep } from "@/components/gitbackup/dest-step"
import { ScheduleFields, type Sched } from "@/components/gitbackup/schedule-fields"
import { DIALOG_BACKDROP, DIALOG_POPUP } from "@/components/overlay-styles"
import { RADIO_INPUT, SECTION, TOUCH } from "@/components/registry-ui"
import { SubmitButton } from "@/components/submit-button"
import { useNotice } from "@/components/toaster"
import { FormError } from "@/components/two-factor"
import { Button } from "@/components/ui/button"
import type { DestInput } from "@/lib/gitbackup/setup"
import type { HostView } from "@/lib/server-backup/hosts"
import type { JobView } from "@/lib/server-backup/jobs"
import { RetentionFields, WhatFields, type Keep, type What } from "./fields"
import { BASE } from "./format"

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

export function Settings({ job, host, min }: { job: JobView; host: HostView; min: number }) {
  const router = useRouter()
  const setNotice = useNotice()
  const [sched, setSched] = useState<Sched>({ name: job.name, prefix: "", intervalMin: job.intervalMin, keepLast: 0, lfs: false })
  const [keep, setKeep] = useState<Keep>(job.retention)
  const [what, setWhat] = useState<What>({ paths: job.paths.join("\n"), excludes: job.excludes.join("\n"), volumes: job.volumes, stopContainers: job.stopContainers, preHook: job.preHook, postHook: job.postHook })
  const [changeDest, setChangeDest] = useState(false)
  const [dest, setDest] = useState<DestInput | null>(null)
  const [error, setError] = useState<string>()
  const [saved, setSaved] = useState(false)
  const [pending, start] = useTransition()
  const [deleting, setDeleting] = useState(false)
  const keepOk = [keep.daily, keep.weekly, keep.monthly].every((n) => Number.isInteger(n) && n >= 0) && keep.daily + keep.weekly + keep.monthly > 0
  return (
    <div className="flex flex-col gap-10">
      <form
        className="flex flex-col gap-8"
        onSubmit={(e) => {
          e.preventDefault()
          setError(undefined)
          setSaved(false)
          start(async () => {
            const r = await updateJob(job.id, { name: sched.name, ...what, intervalMin: sched.intervalMin, retention: keep, dest: changeDest ? (dest ?? undefined) : undefined })
            if (r.error) return setError(r.error)
            setSaved(true)
            setChangeDest(false)
            setNotice({ text: "Saved." })
          })
        }}
      >
        <Section title="Job" hint={job.hostMode === "agent" ? "The name and what is kept. The schedule is the cron line on the server." : "The name, schedule and what is kept. Changes apply from the next backup."}>
          <ScheduleFields value={sched} onChange={setSched} min={min} showName compact />
          <RetentionFields value={keep} onChange={setKeep} />
        </Section>
        <Section title="What to back up" hint={`On ${job.hostLabel}.`}>
          <WhatFields host={host} value={what} onChange={setWhat} />
        </Section>
        <Section title="Storage" hint="The restic repository: encrypted, deduplicated snapshots.">
          <p className="rounded-lg border px-3 py-2.5 text-sm">
            <span className="text-muted-foreground">{job.destKind === "nimbus" ? "Nimbus S3 bucket " : "Bucket "}</span>
            <span className="font-mono">{job.bucket}</span>
            <span className="block truncate font-mono text-xs text-muted-foreground" title={`${job.endpoint}/${job.prefix}`}>{job.endpoint}/{job.prefix}</span>
          </p>
          {changeDest ? (
            <div className="grid gap-3">
              <p className="text-sm text-pretty text-muted-foreground">New backups go to a new repository there, with the same password. Existing snapshots stay where they are and are no longer listed here.</p>
              <DestStep onChange={setDest} jobName={sched.name} actions={{ nimbusOptions, testS3 }} label="Server Backup" existing={job.destKind === "s3" ? { endpoint: job.endpoint, region: job.region, bucket: job.bucket, accessKey: job.accessKey, pathStyle: job.pathStyle } : undefined} />
              <Button type="button" variant="ghost" className={`${TOUCH} w-fit`} onClick={() => (setChangeDest(false), setDest(null))}>Keep the current storage</Button>
            </div>
          ) : (
            <Button type="button" variant="outline" className={`${TOUCH} w-fit`} onClick={() => setChangeDest(true)}>Change storage…</Button>
          )}
        </Section>
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton pending={pending} disabled={(changeDest && !dest) || (job.hostMode === "ssh" && sched.intervalMin < min) || !keepOk} className={TOUCH}>Save changes</SubmitButton>
          {saved && <p role="status" className="text-sm text-muted-foreground">Saved.</p>}
        </div>
        <FormError>{error}</FormError>
      </form>
      <Section title="Delete this job" hint="Stops all backups for it. Nothing on the server is touched.">
        <Button variant="outline" className={`${TOUCH} w-fit text-destructive hover:text-destructive`} onClick={() => setDeleting(true)}>Delete job…</Button>
      </Section>
      <DeleteDialog job={job} open={deleting} onClose={() => setDeleting(false)} onDone={() => router.push(BASE)} />
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
              {job.snapshots} snapshot record{job.snapshots === 1 ? "" : "s"} are removed from Nimbus, along with the sealed repository password.
              {job.destKind === "nimbus" ? " The access key made for this job is revoked; the bucket stays." : ""} Without the password the stored backups can&apos;t be read again.
            </Dialog.Description>
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm">
            <input type="checkbox" className={`${RADIO_INPUT} mt-0.5`} checked={purge} onChange={(e) => setPurge(e.target.checked)} />
            <span className="grid gap-0.5">
              <span className="font-medium">Also delete the stored backups</span>
              <span className="text-muted-foreground">Removes the whole repository from the bucket. This can&apos;t be undone.</span>
            </span>
          </label>
          <FormError>{error}</FormError>
          <div className="flex justify-end gap-2">
            <Dialog.Close disabled={pending} render={<Button variant="outline" className={TOUCH} />}>Cancel</Dialog.Close>
            <Button variant="destructive" className={TOUCH} disabled={pending} onClick={() => start(async () => { const r = await deleteJob(job.id, purge); if ("error" in r && r.error) return setError(r.error); setNotice({ text: `Deleted “${job.name}”.` }); onDone() })}>
              {pending ? "Deleting…" : "Delete job"}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
