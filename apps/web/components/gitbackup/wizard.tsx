"use client"

import { ArrowLeftIcon, ArrowRightIcon } from "@phosphor-icons/react"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import { createJob } from "@/app/(app)/more/github-backup/actions"
import { SubmitButton } from "@/components/submit-button"
import { FormError } from "@/components/two-factor"
import { Button } from "@/components/ui/button"
import { TOUCH } from "@/components/registry-ui"
import type { ConnView, Ref, RegistryPick } from "@/lib/gitbackup/connections"
import type { DestInput } from "@/lib/gitbackup/setup"
import { ConnectStep } from "./connect-step"
import { DestStep } from "./dest-step"
import { emptyScope, ScopeFields, scopeNewOnly, scopeOwners, scopeReady, type Scope } from "./scope"
import { ScheduleFields, type Sched } from "./schedule-fields"

const STEPS = ["Connect", "Storage", "What to back up", "Schedule"] as const

export function Wizard({ connections, registry, oauth, min, connected, intro, onCancel }: { connections: ConnView[]; registry: RegistryPick[]; oauth: boolean; min: number; connected?: string; intro?: boolean; onCancel?: () => void }) {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [conn, setConn] = useState<Ref | null>(connected && connections.some((c) => c.id === connected) ? { connectionId: connected } : null)
  const [dest, setDest] = useState<DestInput | null>(null)
  const [scope, setScope] = useState<Scope>(emptyScope)
  const [sched, setSched] = useState<Sched>({ name: "Git backup", prefix: "git-backup", intervalMin: Math.max(60, min), keepLast: 10, lfs: true })
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()

  const ok = [conn !== null, dest !== null, scopeReady(scope), sched.name.trim() !== "" && sched.intervalMin >= min && sched.keepLast >= 1][step]
  const create = () =>
    start(async () => {
      setError(undefined)
      const r = await createJob({ ...sched, autoOwners: scopeOwners(scope), newOnly: scopeNewOnly(scope), connection: conn!, dest: dest!, repos: scope.mode === "repos" ? scope.repos : [] })
      if ("error" in r && r.error) return setError(r.error)
      router.push(`/more/github-backup?job=${(r as { id: string }).id}`)
    })

  return (
    <div className="flex flex-col gap-5 rounded-xl border bg-card p-4 sm:p-6">
      <div className="grid gap-1">
        <p className="text-sm text-muted-foreground tabular-nums">
          Step {step + 1} of {STEPS.length}
        </p>
        <h2 className="text-base font-semibold">{STEPS[step]}</h2>
        {intro && step === 0 && <p className="max-w-prose text-sm text-pretty text-muted-foreground">Connect your git host, choose where to store the copies and pick what to back up. It takes about a minute.</p>}
      </div>
      {step === 0 && <ConnectStep connections={connections} registry={registry} oauth={oauth} value={conn} onChange={setConn} />}
      <div hidden={step !== 1}>
        <DestStep onChange={setDest} jobName={sched.name} />
      </div>
      {step === 2 && conn && <ScopeFields connection={conn} value={scope} onChange={setScope} picker />}
      {step === 3 && (
        <>
          <ScheduleFields value={sched} onChange={setSched} min={min} showName />
          <p className="text-sm text-pretty text-muted-foreground">
            {scope.mode === "all"
              ? "Everything this token can see, new repos included."
              : scope.mode === "owners"
                ? `All repos of ${scope.owners.join(", ")}, new ones included.`
                : `${scope.repos.length} repo${scope.repos.length === 1 ? "" : "s"} selected${scope.extra.length ? `, plus new ones from ${scope.extra.join(", ")}` : ""}.`}{" "}
            The first backup starts as soon as you create the job.
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
            <SubmitButton pending={pending} disabled={!ok} className={TOUCH}>
              Create and back up
            </SubmitButton>
          </form>
        )}
      </div>
    </div>
  )
}
