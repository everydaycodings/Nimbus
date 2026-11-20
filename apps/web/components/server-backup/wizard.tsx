"use client"

import { ArrowLeftIcon, ArrowRightIcon, CheckCircleIcon, WarningIcon } from "@phosphor-icons/react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useId, useState, useTransition } from "react"

import { createJob, nimbusOptions, saveTokenToSecret, testS3 } from "@/app/(app)/more/server-backup/actions"
import { CopyButton } from "@/components/copy-button"
import { DestStep } from "@/components/gitbackup/dest-step"
import { ScheduleFields, type Sched } from "@/components/gitbackup/schedule-fields"
import { Code, RADIO, RADIO_INPUT, TOUCH } from "@/components/registry-ui"
import { SaveToSecrets } from "@/components/registry-save-secret"
import { SubmitButton } from "@/components/submit-button"
import { FormError } from "@/components/two-factor"
import { Button } from "@/components/ui/button"
import type { DestInput } from "@/lib/gitbackup/setup"
import type { HostView } from "@/lib/server-backup/hosts"
import { DEFAULT_RETENTION } from "@/lib/server-backup/rules"
import { cn } from "@/lib/utils"
import { emptyWhat, RetentionFields, WhatFields, type Keep, type What } from "./fields"
import { BASE } from "./format"

const STEPS = ["Server", "What to back up", "Storage", "Schedule"] as const

// A server can be used once Nimbus knows how to reach it: a tested ssh host, this server, or an agent.
export const usable = (h: HostView) => h.isSelf || h.mode === "agent" || h.fingerprint !== null

// The repository password, shown once. Nimbus keeps it sealed and can restore without it; the member needs it for restic on their own.
function Password({ jobId, password }: { jobId: string; password: string }) {
  const router = useRouter()
  const id = useId()
  const [saved, setSaved] = useState(false)
  return (
    <div className="flex flex-col gap-5 rounded-xl border bg-card p-4 sm:p-6">
      <div className="grid gap-1">
        <p className="text-sm text-muted-foreground">Last step</p>
        <h2 className="text-base font-semibold">Save your repository password</h2>
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">
          Every backup is encrypted with this password. Nimbus keeps a sealed copy and uses it to restore, but <strong className="text-foreground">it will not show it again</strong>. Without it your backups can&apos;t be read with restic outside Nimbus.
        </p>
      </div>
      <div className="relative">
        <Code copy wrap>{password}</Code>
        <CopyButton value={password} label="Copy the password" className="absolute top-2 right-2" />
      </div>
      <details className="rounded-lg border px-3 py-2.5">
        <summary className="cursor-pointer text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">Keep a copy in Secrets (optional)</summary>
        <div className="mt-3"><SaveToSecrets token={password} defaultName="SERVER_BACKUP_PASSWORD" save={saveTokenToSecret} /></div>
      </details>
      <label htmlFor={`${id}-ok`} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm">
        <input id={`${id}-ok`} type="checkbox" className="size-4 accent-primary" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        I saved the password somewhere safe
      </label>
      <div>
        <Button className={TOUCH} disabled={!saved} onClick={() => router.push(`${BASE}?job=${jobId}`)}>Open the job</Button>
      </div>
    </div>
  )
}

export function Wizard({ hosts, admin, min, preselect, onCancel }: { hosts: HostView[]; admin: boolean; min: number; preselect?: string; onCancel?: () => void }) {
  const [step, setStep] = useState(0)
  const first = hosts.find((h) => h.id === preselect && usable(h)) ?? hosts.find(usable)
  const [hostId, setHostId] = useState(first?.id ?? "")
  const [what, setWhat] = useState<What>(emptyWhat)
  const [dest, setDest] = useState<DestInput | null>(null)
  const [sched, setSched] = useState<Sched>({ name: "", prefix: "", intervalMin: Math.max(1440, min), keepLast: 0, lfs: false })
  const [keep, setKeep] = useState<Keep>(DEFAULT_RETENTION)
  const [error, setError] = useState<string>()
  const [made, setMade] = useState<{ id: string; password: string } | null>(null)
  const [pending, start] = useTransition()
  const host = hosts.find((h) => h.id === hostId)

  const whatOk = what.paths.trim() !== "" || what.volumes.length > 0
  const keepOk = [keep.daily, keep.weekly, keep.monthly].every((n) => Number.isInteger(n) && n >= 0) && keep.daily + keep.weekly + keep.monthly > 0
  const ok = [Boolean(host), whatOk, dest !== null, sched.name.trim() !== "" && sched.intervalMin >= min && keepOk][step]
  const create = () =>
    start(async () => {
      setError(undefined)
      const r = await createJob({ name: sched.name, hostId, ...what, intervalMin: sched.intervalMin, retention: keep, dest: dest! })
      if ("error" in r && r.error) return setError(r.error)
      setMade(r as { id: string; password: string })
    })

  if (made) return <Password jobId={made.id} password={made.password} />
  const pick = hosts.filter((h) => !h.isSelf || admin)
  return (
    <div className="flex flex-col gap-5 rounded-xl border bg-card p-4 sm:p-6">
      <div className="grid gap-1">
        <p className="text-sm text-muted-foreground tabular-nums">Step {step + 1} of {STEPS.length}</p>
        <h2 className="text-base font-semibold">{STEPS[step]}</h2>
      </div>
      {step === 0 &&
        (pick.length === 0 ? (
          <p className="text-sm text-pretty text-muted-foreground">
            You haven&apos;t added a server yet.{" "}
            <Link href={`${BASE}?view=servers`} className="rounded-sm underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">Add one</Link> first.
          </p>
        ) : (
          <fieldset className="grid gap-2">
            <legend className="sr-only">Server</legend>
            {pick.map((h) => (
              <label key={h.id} className={cn(RADIO, "items-start", !usable(h) && "opacity-60")}>
                <input type="radio" name="sb-host" className={cn(RADIO_INPUT, "mt-0.5")} checked={hostId === h.id} disabled={!usable(h)} onChange={() => (setHostId(h.id), setWhat(emptyWhat))} />
                <span className="grid min-w-0 gap-0.5">
                  <span className="truncate font-medium">{h.label}</span>
                  <span className="truncate font-mono text-xs text-muted-foreground">{h.isSelf ? "This Nimbus server" : h.mode === "agent" ? "Push agent" : `${h.username}@${h.host}:${h.port}`}</span>
                  {!usable(h) && <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><WarningIcon aria-hidden className="size-3.5" />Test the connection first, in Servers.</span>}
                </span>
              </label>
            ))}
            <p className="text-sm text-muted-foreground">
              Need another? <Link href={`${BASE}?view=servers`} className="rounded-sm underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">Manage servers</Link>
            </p>
          </fieldset>
        ))}
      {step === 1 && host && <WhatFields host={host} value={what} onChange={setWhat} />}
      <div hidden={step !== 2}>
        <DestStep onChange={setDest} jobName={sched.name} actions={{ nimbusOptions, testS3 }} label="Server Backup" />
      </div>
      {step === 3 && (
        <>
          <ScheduleFields value={sched} onChange={setSched} min={min} showName compact />
          <RetentionFields value={keep} onChange={setKeep} />
          <p className="flex items-start gap-2 text-sm text-pretty text-muted-foreground">
            <CheckCircleIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" />
            {host?.mode === "agent" ? "Next you'll get the script to run on the server." : "The first backup starts as soon as you create the job. After it, you'll see the repository password once."}
          </p>
        </>
      )}
      <FormError>{error}</FormError>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" className={TOUCH} disabled={pending} onClick={() => (step ? setStep(step - 1) : onCancel?.())} hidden={!step && !onCancel}>
          {step ? <ArrowLeftIcon /> : null}
          {step ? "Back" : "Cancel"}
        </Button>
        {step < 3 ? (
          <Button type="button" className={TOUCH} disabled={!ok} onClick={() => setStep(step + 1)}>
            Next
            <ArrowRightIcon />
          </Button>
        ) : (
          <form action={create}>
            <SubmitButton pending={pending} disabled={!ok} className={TOUCH}>Create and back up</SubmitButton>
          </form>
        )}
      </div>
    </div>
  )
}
