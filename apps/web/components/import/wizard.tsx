"use client"

import { ArrowLeftIcon, ArrowRightIcon } from "@phosphor-icons/react"
import { useRouter } from "next/navigation"
import { useCallback, useId, useMemo, useState, useTransition } from "react"

import { createJob } from "@/app/(app)/more/import/actions"
import { SubmitButton } from "@/components/submit-button"
import { FormError } from "@/components/two-factor"
import { TOUCH } from "@/components/registry-ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { ConnView } from "@/lib/import/connections"
import { DEFAULT_OPTIONS, MIN_INTERVAL, type ImportOptions } from "@/lib/import/rules"
import type { Ready } from "./add-connection"
import { FolderStep, type Picked } from "./folder-step"
import { OptionsStep } from "./options-step"
import { ScheduleFields } from "./schedule-fields"
import { SourceStep, type Source } from "./source-step"
import { TargetPicker, type Target } from "./target-picker"

const TITLES = { source: "Source", folders: "Folders", target: "Destination", options: "Options", schedule: "Schedule" } as const
type Step = keyof typeof TITLES

// Bring files over: the source, the folders (with a size check), the Files folder to put them in, options and when.
// A Takeout import skips the folders and the schedule.
export function Wizard({ connections, oauth, connected, intro, onCancel }: { connections: ConnView[]; oauth: Ready; connected?: string; intro?: boolean; onCancel?: () => void }) {
  const router = useRouter()
  const id = useId()
  const [i, setI] = useState(0)
  const [source, setSource] = useState<Source | null>(connected && connections.some((c) => c.id === connected) ? { kind: "cloud", connectionId: connected } : null)
  const [zipIds, setZipIds] = useState<string[]>([])
  const [paths, setPaths] = useState<string[]>([])
  const [total, setTotal] = useState<Picked>({ paths: [], files: 0, bytes: 0, measuring: false })
  const [target, setTarget] = useState<Target | null>(null)
  const [options, setOptions] = useState<ImportOptions>(DEFAULT_OPTIONS)
  const [every, setEvery] = useState<number | null>(null)
  const [name, setName] = useState("")
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()

  const takeout = source?.kind === "takeout"
  const conn = source?.kind === "cloud" ? connections.find((c) => c.id === source.connectionId) : undefined
  const steps: Step[] = takeout ? ["source", "target", "options"] : ["source", "folders", "target", "options", "schedule"]
  const step = steps[Math.min(i, steps.length - 1)]
  const last = i >= steps.length - 1
  const jobName = name.trim() || (takeout ? "Google Takeout" : (conn?.label ?? ""))
  const ok = {
    source: takeout ? zipIds.length > 0 : Boolean(conn),
    folders: paths.length > 0,
    target: target !== null && jobName !== "",
    options: true,
    schedule: every === null || every >= MIN_INTERVAL,
  }[step]
  const measure = useCallback((t: Picked) => setTotal((o) => (o.files === t.files && o.bytes === t.bytes && o.measuring === t.measuring && o.paths === t.paths ? o : t)), [])
  const sourceKey = source ? (source.kind === "cloud" ? source.connectionId : "takeout") : ""
  const resetFolders = (s: Source) => {
    if ((s.kind === "cloud" ? s.connectionId : "takeout") !== sourceKey) setPaths([])
    setSource(s)
  }
  const drive = conn?.provider === "gdrive"
  const summary = useMemo(() => (takeout ? `${zipIds.length} zip${zipIds.length === 1 ? "" : "s"}` : `${paths.length} folder${paths.length === 1 ? "" : "s"}`), [takeout, zipIds.length, paths.length])

  const create = () =>
    start(async () => {
      setError(undefined)
      const r = await createJob({
        name: jobName,
        kind: takeout ? "takeout" : "rclone",
        connectionId: conn?.id,
        sources: takeout ? zipIds : paths,
        targetNodeId: target!.id,
        options,
        intervalMin: takeout ? null : every,
        estFiles: total.files,
        estBytes: total.bytes,
      })
      if ("error" in r && r.error) return setError(r.error)
      router.push(`/more/import?job=${(r as { id: string }).id}`)
    })

  return (
    <div className="flex flex-col gap-5 rounded-xl border bg-card p-4 sm:p-6">
      <div className="grid gap-1">
        <p className="text-sm text-muted-foreground tabular-nums">
          Step {i + 1} of {steps.length}
        </p>
        <h2 className="text-base font-semibold">{TITLES[step]}</h2>
        {intro && step === "source" && <p className="max-w-prose text-sm text-pretty text-muted-foreground">Connect where your files are, pick folders, and Nimbus brings them over and keeps their dates. It only reads from the source and never deletes anything.</p>}
      </div>
      {step === "source" && <SourceStep connections={connections} oauth={oauth} value={source} onChange={resetFolders} zipIds={zipIds} onZips={setZipIds} />}
      {step === "folders" && conn && <FolderStep connectionId={conn.id} value={paths} onChange={setPaths} onMeasure={measure} />}
      {step === "target" && (
        <div className="flex flex-col gap-5">
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">Put the files in</span>
            <TargetPicker value={target} onChange={setTarget} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-name`}>Name this import</Label>
            <Input id={`${id}-name`} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={takeout ? "Google Takeout" : (conn?.label ?? "My import")} autoComplete="off" className="pointer-coarse:h-11" />
          </div>
        </div>
      )}
      {step === "options" && (
        <>
          <OptionsStep value={options} onChange={setOptions} drive={drive} takeout={takeout} />
          {takeout && <p className="text-sm text-pretty text-muted-foreground">{summary} will be read and brought into {target?.path ?? "your folder"}. It starts as soon as you create the import.</p>}
        </>
      )}
      {step === "schedule" && (
        <>
          <ScheduleFields value={every} onChange={setEvery} />
          <p className="text-sm text-pretty text-muted-foreground">
            {summary}{total.files ? ` · ${total.files.toLocaleString("en")} files` : ""} into {target?.path}. It starts as soon as you create the import.
          </p>
        </>
      )}
      <FormError>{error}</FormError>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" className={TOUCH} disabled={pending} onClick={() => (i ? setI(i - 1) : onCancel?.())} hidden={!i && !onCancel}>
          {i ? <ArrowLeftIcon /> : null}
          {i ? "Back" : "Cancel"}
        </Button>
        {!last ? (
          <Button type="button" className={TOUCH} disabled={!ok} onClick={() => setI(i + 1)}>
            Next
            <ArrowRightIcon />
          </Button>
        ) : (
          <form action={create}>
            <SubmitButton pending={pending} disabled={!ok} className={TOUCH}>
              Create and import
            </SubmitButton>
          </form>
        )}
      </div>
    </div>
  )
}
