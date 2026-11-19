"use client"

import { useRouter } from "next/navigation"
import { useId, useState, useTransition } from "react"

import { setBucketLifecycle } from "@/app/(app)/buckets/actions"
import { RuleDialog } from "@/components/buckets/rule-dialog"
import { Confirm, Heading, SECTION, TOUCH, WHEN } from "@/components/registry-ui"
import { useNotice } from "@/components/toaster"
import { FormError } from "@/components/two-factor"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { LifecycleRule, LifecycleRun } from "@/lib/s3api/bucket-config"

const MAX_DAYS = 36500
const MAX_KEEP = 100
// Field, label, hint, unit, largest value.
const ACTIONS = [
  ["expireDays", "Move objects to Trash after", "Objects go to your Nimbus Trash, not deleted for good.", "days", MAX_DAYS],
  ["noncurrentDays", "Remove old versions after", "Counted from when a newer version replaced it.", "days", MAX_DAYS],
  [
    "keepNewer",
    "Keep only the newest",
    "Older versions beyond this many are removed. With the option above, a version goes only once it's past both.",
    "old versions",
    MAX_KEEP,
  ],
  ["abortMultipartDays", "Cancel unfinished uploads after", "Large uploads that never finished.", "days", MAX_DAYS],
] as const
type Field = (typeof ACTIONS)[number][0]

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const days = (n: number) => plural(n, "day")

function summary(r: LifecycleRule) {
  const parts = [
    r.expireDays !== null && `Move to Trash after ${days(r.expireDays)}`,
    r.noncurrentDays !== null && `Remove old versions after ${days(r.noncurrentDays)}`,
    r.keepNewer != null && `Keep the newest ${plural(r.keepNewer, "old version")}`,
    r.abortMultipartDays !== null && `Cancel unfinished uploads after ${days(r.abortMultipartDays)}`,
  ]
  return parts.filter(Boolean) as string[]
}

function lastRun(run: LifecycleRun | null) {
  if (!run) return "Runs once a day; hasn't run yet."
  const at = WHEN.format(new Date(run.at))
  if (run.error) return `Last run: ${at} failed: ${run.error}`
  return `Last run: ${at} — moved ${run.trashed} to Trash, removed ${plural(run.versions, "old version")}, cancelled ${plural(run.uploads, "upload")}.`
}

export function SettingsLifecycle({ bucketId, rules, run }: { bucketId: string; rules: LifecycleRule[]; run: LifecycleRun | null }) {
  const router = useRouter()
  const setNotice = useNotice()
  const [editing, setEditing] = useState<LifecycleRule | "new" | null>(null)
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()

  const save = (next: LifecycleRule[], done: string, ok?: () => void) =>
    start(async () => {
      setError(undefined)
      const r = await setBucketLifecycle(bucketId, next)
      if (r.error) return setError(r.error)
      setNotice({ text: done })
      ok?.()
      router.refresh()
    })

  return (
    <section className={SECTION} aria-labelledby="lifecycle-heading">
      <Heading
        id="lifecycle-heading"
        title="Lifecycle rules"
        hint="Tidy up on a schedule. Rules run once a day and only touch files that match the folder prefix."
      >
        <Button type="button" variant="outline" size="sm" className={TOUCH} onClick={() => setEditing("new")}>
          Add rule
        </Button>
      </Heading>
      {rules.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">No rules. Nothing is cleaned up on its own.</p>
      ) : (
        <ul className="grid gap-2">
          {rules.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-card px-4 py-3">
              <div className="min-w-0 flex-1 basis-56">
                <p className="text-sm font-medium">{r.prefix ? <span className="font-mono break-all">{r.prefix}</span> : "Whole bucket"}</p>
                <ul className="text-sm text-muted-foreground">
                  {summary(r).map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button type="button" variant="outline" size="sm" className={TOUCH} disabled={pending} onClick={() => setEditing(r)}>
                  Edit
                </Button>
                <Confirm
                  label="Delete"
                  ariaLabel={`Delete rule for ${r.prefix || "the whole bucket"}`}
                  question="Delete this rule?"
                  yes="Delete rule"
                  pending={pending}
                  onYes={() => save(rules.filter((x) => x.id !== r.id), "Deleted the rule.")}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      {(rules.length > 0 || run) && <p className="text-sm text-muted-foreground tabular-nums">{lastRun(run)}</p>}
      {!editing && <FormError>{error}</FormError>}
      {editing && (
        <LifecycleDialog
          rule={editing === "new" ? null : editing}
          pending={pending}
          error={error}
          onClose={() => setEditing(null)}
          onSave={(rule) =>
            save(editing === "new" ? [...rules, rule] : rules.map((x) => (x.id === rule.id ? rule : x)), "Saved the rule.", () => setEditing(null))
          }
        />
      )}
    </section>
  )
}

function LifecycleDialog({
  rule,
  pending,
  error,
  onSave,
  onClose,
}: {
  rule: LifecycleRule | null
  pending: boolean
  error?: string
  onSave: (r: LifecycleRule) => void
  onClose: () => void
}) {
  const id = useId()
  const [prefix, setPrefix] = useState(rule?.prefix ?? "")
  const [vals, setVals] = useState<Record<Field, string>>({
    expireDays: String(rule?.expireDays ?? ""),
    noncurrentDays: String(rule?.noncurrentDays ?? ""),
    keepNewer: String(rule?.keepNewer ?? ""),
    abortMultipartDays: String(rule?.abortMultipartDays ?? ""),
  })
  const [on, setOn] = useState<Record<Field, boolean>>({
    expireDays: rule?.expireDays != null,
    noncurrentDays: rule?.noncurrentDays != null,
    keepNewer: rule?.keepNewer != null,
    abortMultipartDays: rule?.abortMultipartDays != null,
  })
  const bad = (f: Field) => {
    const [, , , unit, max] = ACTIONS.find((a) => a[0] === f)!
    const n = Number(vals[f])
    return on[f] && !(Number.isInteger(n) && n >= 1 && n <= max) ? `Enter a whole number from 1 to ${max} (${unit}).` : null
  }
  const none = !ACTIONS.some(([f]) => on[f])
  const prefixBad = prefix.startsWith("/") ? "Leave out the leading slash." : null
  const invalid = none || Boolean(prefixBad) || ACTIONS.some(([f]) => bad(f))
  const num = (f: Field) => (on[f] ? Number(vals[f]) : null)

  return (
    <RuleDialog
      title={rule ? "Edit rule" : "Add rule"}
      description="Pick what should happen to matching files and how old they must be."
      pending={pending}
      error={error}
      disabled={invalid}
      onClose={onClose}
      onSubmit={() =>
        onSave({
          id: rule?.id ?? crypto.randomUUID(),
          prefix: prefix.trim(),
          expireDays: num("expireDays"),
          noncurrentDays: num("noncurrentDays"),
          keepNewer: num("keepNewer"),
          abortMultipartDays: num("abortMultipartDays"),
        })
      }
    >
      <div className="grid gap-2">
        <Label htmlFor={`${id}-prefix`}>Folder prefix (optional)</Label>
        <Input
          id={`${id}-prefix`}
          value={prefix}
          onChange={(e) => setPrefix(e.target.value)}
          placeholder="logs/"
          autoComplete="off"
          spellCheck={false}
          className="font-mono"
          aria-invalid={prefixBad ? true : undefined}
          aria-describedby={`${id}-prefix-hint`}
        />
        <p id={`${id}-prefix-hint`} className={prefixBad ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
          {prefixBad ?? "Blank applies the rule to the whole bucket."}
        </p>
      </div>
      <fieldset className="grid gap-3">
        <legend className="mb-1 text-sm font-medium">What to do</legend>
        {ACTIONS.map(([f, label, hint, unit, max]) => (
          <div key={f} className="grid gap-1.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <label className="flex min-h-8 items-center gap-2 text-sm pointer-coarse:min-h-11">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={on[f]}
                  onChange={(e) => setOn({ ...on, [f]: e.target.checked })}
                />
                {label}
              </label>
              <span className="flex items-center gap-2 text-sm">
                <Input
                  type="number"
                  min={1}
                  max={max}
                  step={1}
                  aria-label={`${label}, ${unit}`}
                  aria-invalid={bad(f) ? true : undefined}
                  disabled={!on[f]}
                  value={vals[f]}
                  onChange={(e) => setVals({ ...vals, [f]: e.target.value })}
                  className="w-24"
                />
                {unit}
              </span>
            </div>
            <p className={bad(f) ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{bad(f) ?? hint}</p>
          </div>
        ))}
      </fieldset>
      {none && <p className="text-sm text-muted-foreground">Tick at least one action.</p>}
    </RuleDialog>
  )
}
