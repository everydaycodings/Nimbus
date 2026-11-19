"use client"

import { Dialog } from "@base-ui/react/dialog"
import { useId, useState, useTransition } from "react"

import { createKey, updateKey } from "@/app/(app)/buckets/actions"
import { BucketPicker } from "@/components/buckets/bucket-picker"
import { DIALOG_BACKDROP, DIALOG_POPUP } from "@/components/overlay-styles"
import { DAY, RADIO, RADIO_INPUT, SELECT, Switch, TOUCH } from "@/components/registry-ui"
import { SubmitButton } from "@/components/submit-button"
import { useNotice } from "@/components/toaster"
import { FormError } from "@/components/two-factor"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { BucketRow, KeyRow } from "@/lib/s3api/manage"
import { cidrError } from "@/lib/s3api/cidr"
import { MAX_IPS, MAX_PREFIX, MAX_ROTATE_DAYS, PERMS, PRESETS, presetOf, prefixError, type Perm } from "@/lib/s3api/perms"
import { cn } from "@/lib/utils"

export type Made = { accessKeyId: string; secret: string; name: string; bucket: string | null }

const EXPIRY = [
  ["never", "Never"],
  ["30", "In 30 days"],
  ["90", "In 90 days"],
  ["365", "In a year"],
  ["date", "On a date…"],
] as const
const PERM_LABEL: Record<Perm, [string, string]> = {
  list: ["List", "See which objects exist."],
  read: ["Read", "Download objects."],
  write: ["Write", "Upload and copy objects."],
  delete: ["Delete", "Delete objects and versions."],
}
const FIELD = "pointer-coarse:h-11"

// Splits what was typed into addresses: one per line, or separated by commas or spaces.
const ipList = (text: string) => text.split(/[\s,]+/).filter(Boolean)

// Make a key, or with `editing` change one. The form is remounted each time the dialog opens, so it starts fresh.
export function KeyDialog({
  open,
  editing,
  preset,
  buckets,
  onClose,
  onMade,
}: {
  open: boolean
  editing: KeyRow | null
  // A bucket id to start with "Only some buckets" and that one ticked.
  preset?: string | null
  buckets: BucketRow[]
  onClose: () => void
  onMade?: (m: Made) => void
}) {
  const [pending, setPending] = useState(false)
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && !pending && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={cn(DIALOG_POPUP, "max-h-[calc(100svh-2rem)] max-w-lg overflow-y-auto")}>
          <div className="grid gap-1.5">
            <Dialog.Title className="text-base font-semibold">{editing ? `Edit “${editing.name}”` : "New access key"}</Dialog.Title>
            <Dialog.Description className="text-sm text-pretty text-muted-foreground">
              {editing
                ? "Changes apply to the next request. The secret stays as it is; use Rotate secret to change it."
                : "One per app. Pick what it can do, what it can reach and when it stops working."}
            </Dialog.Description>
          </div>
          <KeyForm editing={editing} preset={preset} buckets={buckets} onClose={onClose} onMade={onMade} onPending={setPending} />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function KeyForm({
  editing,
  preset,
  buckets,
  onClose,
  onMade,
  onPending,
}: {
  editing: KeyRow | null
  preset?: string | null
  buckets: BucketRow[]
  onClose: () => void
  onMade?: (m: Made) => void
  onPending: (p: boolean) => void
}) {
  const id = useId()
  const setNotice = useNotice()
  const [name, setName] = useState(editing?.name ?? "")
  const [pick, setPick] = useState<keyof typeof PRESETS | "custom">(editing ? presetOf(editing.perms) : "rw")
  const [perms, setPerms] = useState<Perm[]>(editing ? (editing.perms as Perm[]) : [...PRESETS.rw.perms])
  const [all, setAll] = useState(editing ? editing.allBuckets : !preset)
  const [chosen, setChosen] = useState<string[]>(editing ? editing.bucketIds : preset ? [preset] : [])
  const [expiry, setExpiry] = useState(editing ? "keep" : "never")
  const [date, setDate] = useState("")
  const [prefix, setPrefix] = useState(editing?.prefix ?? "")
  const [ips, setIps] = useState(editing?.allowedIps.join("\n") ?? "")
  const [remind, setRemind] = useState(Boolean(editing?.rotateEveryDays))
  const [days, setDays] = useState(String(editing?.rotateEveryDays ?? 90))
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()
  const [tomorrow] = useState(() => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10))

  const entries = ipList(ips)
  const ipError = entries.length > MAX_IPS ? `Up to ${MAX_IPS} addresses or ranges.` : entries.map(cidrError).find(Boolean)
  const prefixBad = prefixError(prefix.trim())
  const keepLabel = editing?.expiresAt ? `Keep (${DAY.format(new Date(editing.expiresAt))})` : "Keep (never expires)"

  const choose = (p: keyof typeof PRESETS | "custom") => {
    setPick(p)
    if (p !== "custom") setPerms([...PRESETS[p].perms])
  }
  const toggle = (p: Perm) => setPerms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]))

  const submit = () => {
    setError(undefined)
    onPending(true)
    start(async () => {
      const o = {
        name,
        perms,
        allBuckets: all,
        bucketIds: chosen,
        expiry: expiry === "date" ? date : expiry,
        prefix: prefix.trim(),
        allowedIps: entries,
        rotateEveryDays: remind ? Number(days) : null,
      }
      const r = editing ? await updateKey(editing.id, o) : await createKey(o)
      onPending(false)
      if (r.error) return setError(r.error)
      if (editing) {
        setNotice({ text: `Saved “${name.trim()}”.` })
        return onClose()
      }
      const made = r as { accessKeyId?: string; secret?: string }
      if (!made.secret) return setError("Couldn't make the key.")
      onMade?.({
        accessKeyId: made.accessKeyId!,
        secret: made.secret,
        name: name.trim(),
        bucket: all ? null : (buckets.find((b) => b.id === chosen[0])?.name ?? null),
      })
    })
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor={`${id}-name`}>Name</Label>
        <Input
          id={`${id}-name`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          placeholder="Laptop – rclone"
          autoComplete="off"
          autoFocus
          className={FIELD}
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Permissions</legend>
        {([...Object.entries(PRESETS).map(([k, p]) => [k, p.label, p.hint]), ["custom", "Custom", "Choose exactly what it can do."]] as const).map(([value, label, hint]) => (
          <label key={value} className={RADIO}>
            <input
              type="radio"
              name={`${id}-preset`}
              checked={pick === value}
              onChange={() => choose(value as keyof typeof PRESETS | "custom")}
              className={RADIO_INPUT}
            />
            <span className="grid">
              <span className="font-medium">{label}</span>
              <span className="text-xs text-muted-foreground">{hint}</span>
            </span>
          </label>
        ))}
        {pick === "custom" && (
          <div className="grid gap-2 sm:grid-cols-2">
            {PERMS.map((p) => (
              <label key={p} className={RADIO}>
                <input type="checkbox" checked={perms.includes(p)} onChange={() => toggle(p)} className={RADIO_INPUT} />
                <span className="grid">
                  <span className="font-medium">{PERM_LABEL[p][0]}</span>
                  <span className="text-xs text-muted-foreground">{PERM_LABEL[p][1]}</span>
                </span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Buckets</legend>
        <label className={RADIO}>
          <input type="radio" name={`${id}-scope`} checked={all} onChange={() => setAll(true)} className={RADIO_INPUT} />
          <span className="grid">
            <span className="font-medium">All buckets</span>
            <span className="text-xs text-muted-foreground">Including ones you make later.</span>
          </span>
        </label>
        <label className={cn(RADIO, !buckets.length && "cursor-not-allowed opacity-60")}>
          <input
            type="radio"
            name={`${id}-scope`}
            checked={!all}
            disabled={!buckets.length}
            onChange={() => setAll(false)}
            className={RADIO_INPUT}
          />
          <span className="grid">
            <span className="font-medium">Only some buckets</span>
            <span className="text-xs text-muted-foreground">{buckets.length ? "Pick which." : "Make a bucket first."}</span>
          </span>
        </label>
        {!all && <BucketPicker buckets={buckets} value={chosen} onChange={setChosen} />}
      </fieldset>

      <details className="group rounded-lg border" open={Boolean(editing?.prefix || editing?.allowedIps.length)}>
        <summary className="flex min-h-11 cursor-pointer items-center rounded-lg px-3 text-sm font-medium outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
          More limits
          <span className="ml-2 text-xs font-normal text-muted-foreground">Folder prefix and allowed addresses</span>
        </summary>
        <div className="grid gap-4 border-t p-3">
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-prefix`}>Only keys starting with</Label>
            <Input
              id={`${id}-prefix`}
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              maxLength={MAX_PREFIX}
              placeholder="photos/2024/"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={Boolean(prefixBad)}
              aria-describedby={`${id}-prefix-hint`}
              className={cn("font-mono", FIELD)}
            />
            <p id={`${id}-prefix-hint`} className={cn("text-xs text-pretty", prefixBad ? "text-destructive" : "text-muted-foreground")}>
              {prefixBad ?? "The key can only see and change objects whose path starts with this. End it with / to mean a folder. Leave empty for the whole bucket."}
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-ips`}>Only from these addresses</Label>
            <textarea
              id={`${id}-ips`}
              value={ips}
              onChange={(e) => setIps(e.target.value)}
              rows={3}
              placeholder={"203.0.113.0/24\n2001:db8::/32"}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={Boolean(ipError)}
              aria-describedby={`${id}-ips-hint`}
              className="min-h-20 w-full rounded-md border border-input bg-input/20 px-3 py-2 font-mono text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive"
            />
            <p id={`${id}-ips-hint`} className={cn("text-xs text-pretty", ipError ? "text-destructive" : "text-muted-foreground")}>
              {ipError || "IPv4 or IPv6 addresses or ranges (CIDR), one per line. Requests from anywhere else are refused. Leave empty to allow any address."}
            </p>
          </div>
        </div>
      </details>

      <div className="grid gap-2">
        <Label htmlFor={`${id}-expiry`}>Expires</Label>
        <div className="flex flex-wrap gap-2">
          <select id={`${id}-expiry`} value={expiry} onChange={(e) => setExpiry(e.target.value)} className={cn(SELECT, "flex-1", FIELD)}>
            {editing && <option value="keep">{keepLabel}</option>}
            {EXPIRY.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          {expiry === "date" && (
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              aria-label="Expiry date"
              min={tomorrow}
              required
              className={cn("w-auto flex-1", FIELD)}
            />
          )}
        </div>
      </div>

      <div className="grid gap-2">
        <div className="flex min-h-11 items-center justify-between gap-3">
          <Label htmlFor={`${id}-remind`} className="grid gap-0.5">
            Remind me to rotate
            <span className="text-xs font-normal text-muted-foreground">A reminder and a “Rotation due” badge when the secret gets old.</span>
          </Label>
          <Switch id={`${id}-remind`} checked={remind} onChange={(e) => setRemind(e.target.checked)} />
        </div>
        {remind && (
          <div className="flex items-center gap-2 text-sm">
            <Label htmlFor={`${id}-days`} className="font-normal">
              Every
            </Label>
            <Input
              id={`${id}-days`}
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_ROTATE_DAYS}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className={cn("w-24", FIELD)}
            />
            days
          </div>
        )}
      </div>

      <FormError>{error}</FormError>
      <div className="flex justify-end gap-2">
        <Dialog.Close disabled={pending} render={<Button variant="outline" className={TOUCH} />}>
          Cancel
        </Dialog.Close>
        <SubmitButton pending={pending} disabled={Boolean(ipError || prefixBad || !perms.length)} className={TOUCH}>
          {editing ? "Save changes" : "Create key"}
        </SubmitButton>
      </div>
    </form>
  )
}
