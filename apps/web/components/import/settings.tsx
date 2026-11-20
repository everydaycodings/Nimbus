"use client"

import { useRouter } from "next/navigation"
import { useId, useState, useTransition } from "react"

import { deleteJob, updateJob } from "@/app/(app)/more/import/actions"
import { Confirm, SECTION, TOUCH } from "@/components/registry-ui"
import { SubmitButton } from "@/components/submit-button"
import { useNotice } from "@/components/toaster"
import { FormError } from "@/components/two-factor"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { JobView } from "@/lib/import/jobs"
import { MIN_INTERVAL, type ImportOptions } from "@/lib/import/rules"
import { OptionsStep } from "./options-step"
import { ScheduleFields } from "./schedule-fields"
import { TargetPicker, type Target } from "./target-picker"

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

// Name, target folder, options and schedule. The source and the ticked folders stay as they were set up.
export function Settings({ job }: { job: JobView }) {
  const router = useRouter()
  const setNotice = useNotice()
  const id = useId()
  const [name, setName] = useState(job.name)
  const [target, setTarget] = useState<Target | null>(job.target)
  const [options, setOptions] = useState<ImportOptions>(job.options)
  const [every, setEvery] = useState<number | null>(job.intervalMin)
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()
  const [deleting, startDelete] = useTransition()
  const takeout = job.kind === "takeout"
  const drive = job.connection?.provider === "gdrive"
  return (
    <div className="flex flex-col gap-10">
      <form
        className="flex flex-col gap-8"
        onSubmit={(e) => {
          e.preventDefault()
          setError(undefined)
          start(async () => {
            const r = await updateJob(job.id, { name, sources: job.sources, targetNodeId: target?.id ?? "", options, intervalMin: takeout ? null : every })
            if (r.error) return setError(r.error)
            setNotice({ text: "Saved." })
            router.refresh()
          })
        }}
      >
        <Section title="Import" hint={takeout ? `Reads ${job.zipNames.join(", ")}.` : `From ${job.connection?.label ?? "a deleted connection"}: ${job.sources.map((s) => s || "everything").join(", ")}.`}>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-name`}>Name</Label>
            <Input id={`${id}-name`} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoComplete="off" className="pointer-coarse:h-11" />
          </div>
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">Put the files in</span>
            <TargetPicker value={target} onChange={setTarget} />
          </div>
        </Section>
        <Section title="Options" hint="Applied from the next run. Files already brought over are not changed.">
          <OptionsStep value={options} onChange={setOptions} drive={drive} takeout={takeout} />
        </Section>
        {!takeout && (
          <Section title="Schedule" hint="Change how often it pulls, or make it a one-time import again.">
            <ScheduleFields value={every} onChange={setEvery} />
          </Section>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton pending={pending} disabled={!name.trim() || !target || (every !== null && every < MIN_INTERVAL)} className={TOUCH}>Save changes</SubmitButton>
        </div>
        <FormError>{error}</FormError>
      </form>
      <Section title="Delete this import" hint="Removes the import and its history. Files it brought over stay in Files, and the source isn't touched.">
        <div>
          <Confirm
            label="Delete import"
            question="Delete it? Files already imported stay."
            yes="Delete"
            pending={deleting}
            size="default"
            onYes={() =>
              startDelete(async () => {
                const r = await deleteJob(job.id)
                if (r.error) return setError(r.error)
                setNotice({ text: `Deleted “${job.name}”.` })
                router.push("/more/import")
              })
            }
          />
        </div>
      </Section>
    </div>
  )
}
