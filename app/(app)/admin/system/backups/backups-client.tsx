"use client"

import { Popover } from "@base-ui/react/popover"
import {
  CheckCircleIcon,
  DownloadSimpleIcon,
  PlayIcon,
} from "@phosphor-icons/react"
import { useRouter } from "next/navigation"
import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
} from "react"

import { SubmitButton } from "@/components/submit-button"
import { FormError } from "@/components/two-factor"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SELECT } from "@/components/admin/setting-styles"
import {
  KIND_LABEL,
  PROVIDERS,
  PROVIDER_LABEL,
  type Kind,
  type Provider,
} from "@/lib/backup-rules"
import type { Method } from "@/lib/backup/reauth"
import { cn } from "@/lib/utils"
import {
  type FormState,
  confirmIdentity,
  downloadUrl,
  emailCode,
  saveStorage,
  startBackup,
  testStorage,
} from "./actions"

// Every 2 s while a backup runs, so its steps show as they happen; else every minute.
export function AutoRefresh({ running }: { running: boolean }) {
  const router = useRouter()
  useEffect(() => {
    const t = setInterval(
      () => document.visibilityState === "visible" && router.refresh(),
      running ? 2000 : 60_000
    )
    return () => clearInterval(t)
  }, [router, running])
  return null
}

function Done({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <CheckCircleIcon weight="fill" className="size-4 text-brand" />
      {children}
    </p>
  )
}

// "Back up now", with an optional note and pin for this run.
export function BackupNow({ kind, disabled }: { kind: Kind; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [state, action] = useActionState(async (prev: FormState, form: FormData) => {
    const r = await startBackup(prev, form)
    if (r?.ok) setOpen(false)
    return r
  }, null)
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        disabled={disabled}
        render={<Button variant="outline" size="sm" />}
      >
        <PlayIcon weight="fill" />
        Back up now
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6} className="z-50">
          <Popover.Popup className="w-80 origin-(--transform-origin) rounded-lg border bg-popover p-4 text-popover-foreground shadow-md transition-[opacity,scale] duration-100 outline-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            <form action={action} className="flex flex-col gap-3">
              <input type="hidden" name="kind" value={kind} />
              <Popover.Title className="text-sm font-medium">
                Back up {KIND_LABEL[kind].toLowerCase()} now
              </Popover.Title>
              <div className="grid gap-1.5">
                <Label htmlFor={`note-${kind}`}>Note</Label>
                <textarea
                  id={`note-${kind}`}
                  name="note"
                  rows={2}
                  maxLength={2000}
                  placeholder="Optional, e.g. Before upgrading to 2.0"
                  className="w-full resize-none rounded-md border border-input bg-input/30 px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </div>
              {kind === "db" && (
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="pin" className="mt-0.5 size-4 shrink-0 accent-primary" />
                  <span className="grid gap-0.5">
                    <span>Pin it</span>
                    <span className="text-muted-foreground">Retention never deletes a pinned backup.</span>
                  </span>
                </label>
              )}
              <FormError>{state?.error}</FormError>
              <SubmitButton size="sm" className="self-end">Start</SubmitButton>
            </form>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

const ASK: Record<Exclude<Method, "none">, { label: string; type: string; auto: string }> = {
  password: { label: "Your password", type: "password", auto: "current-password" },
  email: { label: "Code from your email", type: "text", auto: "one-time-code" },
  totp: { label: "Code from your authenticator app", type: "text", auto: "one-time-code" },
}

// Confirms it's really this admin. Unlocks downloads and storage changes for 10 minutes.
export function Reauth({ method, email }: { method: Method; email: string }) {
  const router = useRouter()
  const [state, action] = useActionState(confirmIdentity, null)
  const [sent, send] = useActionState(emailCode, null)
  useEffect(() => {
    if (state?.ok) router.refresh()
  }, [state, router])
  if (method === "none")
    return (
      <p className="text-sm text-pretty text-muted-foreground">
        Nimbus can&apos;t send email yet, so confirming it&apos;s you needs an
        authenticator app. Turn on two-factor under{" "}
        <a href="/account" className="text-foreground underline underline-offset-4">Account</a>
        , or set up{" "}
        <a href="/admin/system/email" className="text-foreground underline underline-offset-4">Email</a>
        . Accounts that sign in only with Google or GitHub need Email.
      </p>
    )
  const ask = ASK[method]
  return (
    <div className="flex flex-col gap-3">
      <form action={action} className="flex flex-wrap items-end gap-3">
        <div className="grid min-w-0 flex-1 gap-1.5">
          <Label htmlFor="secret">{ask.label}</Label>
          <Input
            id="secret"
            name="secret"
            type={ask.type}
            autoComplete={ask.auto}
            inputMode={method === "password" ? undefined : "numeric"}
            maxLength={method === "password" ? undefined : 8}
            className={method === "password" ? "" : "font-mono tracking-widest tabular-nums"}
            required
          />
        </div>
        <SubmitButton>Confirm</SubmitButton>
      </form>
      {method === "email" && (
        <form action={send} className="flex flex-wrap items-center gap-3">
          <SubmitButton variant="ghost" size="sm">Email me a code</SubmitButton>
          {sent?.ok && <Done>Sent to {email}. It works for 10 minutes.</Done>}
          <FormError>{sent?.error}</FormError>
        </form>
      )}
      <FormError>{state?.error}</FormError>
    </div>
  )
}

export function Download({ runId }: { runId: string }) {
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        aria-busy={busy}
        onClick={async () => {
          setBusy(true)
          setError(undefined)
          const r = await downloadUrl(runId)
          setBusy(false)
          if (r.url) window.location.assign(r.url)
          else setError(r.error)
        }}
      >
        <DownloadSimpleIcon />
        Download
      </Button>
      <FormError>{error}</FormError>
    </div>
  )
}

// Never carries a secret: only whether keys are stored.
export type StorageValues = {
  provider: Provider
  endpoint: string
  region: string
  bucket: string
  folder: string
  pathStyle: boolean
  accessKeyHint: string | null
  hasSecret: boolean
  sealedLost: boolean
}

const ENDPOINT_HINT: Record<Provider, string> = {
  aws: "Leave blank for Amazon S3.",
  r2: "https://<account-id>.r2.cloudflarestorage.com",
  b2: "https://s3.<region>.backblazeb2.com",
  wasabi: "https://s3.<region>.wasabisys.com",
  minio: "https://minio.example.com",
  other: "Your provider's S3 endpoint URL.",
}

export function StorageForm({ values, locked }: { values: StorageValues; locked: boolean }) {
  const [provider, setProvider] = useState(values.provider)
  // One state for both buttons, so only the latest result shows.
  const [state, run, busy] = useActionState(
    async (prev: (FormState & { test?: boolean }) | null, form: FormData) => {
      const test = form.get("intent") === "test"
      return { ...(await (test ? testStorage : saveStorage)(prev, form)), test }
    },
    null
  )
  const ref = useRef<HTMLFormElement>(null)
  // After a save, drop typed keys; the fields fall back to the saved values.
  useEffect(() => {
    if (state?.ok && !state.test) ref.current?.reset()
  }, [state])
  const submit = (intent: "test" | "save") => {
    if (!ref.current?.reportValidity()) return
    const data = new FormData(ref.current)
    data.set("intent", intent)
    startTransition(() => run(data))
  }
  const lost = values.sealedLost
  return (
    <form ref={ref} onSubmit={(e) => (e.preventDefault(), submit("save"))} className="flex flex-col gap-5 p-4">
      <div className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid content-start gap-2">
            <Label htmlFor="provider">Provider</Label>
            <select
              id="provider"
              name="provider"
              defaultValue={values.provider}
              onChange={(e) => setProvider(e.target.value as Provider)}
              className={SELECT}
            >
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>
              ))}
            </select>
          </div>
          <div className="grid content-start gap-2">
            <Label htmlFor="endpoint">Endpoint</Label>
            <Input
              id="endpoint"
              name="endpoint"
              defaultValue={values.endpoint}
              placeholder={provider === "aws" ? "" : ENDPOINT_HINT[provider]}
              required={provider !== "aws"}
              spellCheck={false}
              autoComplete="off"
              aria-describedby="endpoint-hint"
            />
            <p id="endpoint-hint" className="text-xs text-muted-foreground">
              {provider === "aws" ? ENDPOINT_HINT.aws : "The S3 API address, not the dashboard."}
            </p>
          </div>
          <div className="grid content-start gap-2">
            <Label htmlFor="bucket">Bucket</Label>
            <Input id="bucket" name="bucket" defaultValue={values.bucket} required spellCheck={false} autoComplete="off" />
          </div>
          <div className="grid content-start gap-2">
            <Label htmlFor="region">Region</Label>
            <Input
              id="region"
              name="region"
              defaultValue={values.region}
              placeholder={provider === "r2" ? "auto" : "us-east-1"}
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          <div className="grid content-start gap-2 sm:col-span-2">
            <Label htmlFor="folder">Folder</Label>
            <Input
              id="folder"
              name="folder"
              defaultValue={values.folder}
              placeholder="nimbus"
              spellCheck={false}
              autoComplete="off"
              aria-describedby="folder-hint"
            />
            <p id="folder-hint" className="text-xs text-muted-foreground">
              Backups go under this prefix: <span className="font-mono">db/</span> for dumps,{" "}
              <span className="font-mono">files/</span> for the mirror. Blank uses the bucket&apos;s top level.
            </p>
          </div>
          <div className="grid content-start gap-2">
            <Label htmlFor="accessKey">Access key ID</Label>
            <Input
              id="accessKey"
              name="accessKey"
              autoComplete="off"
              spellCheck={false}
              placeholder={values.accessKeyHint && !lost ? `…${values.accessKeyHint}` : ""}
              className="font-mono"
              aria-invalid={lost || undefined}
            />
          </div>
          <div className="grid content-start gap-2">
            <Label htmlFor="secretKey">Secret access key</Label>
            <Input
              id="secretKey"
              name="secretKey"
              type="password"
              autoComplete="new-password"
              placeholder={values.hasSecret && !lost ? "••••••••••••" : ""}
              aria-invalid={lost || undefined}
            />
          </div>
          <p className={cn("text-xs sm:col-span-2", lost ? "text-destructive" : "text-muted-foreground")}>
            {lost
              ? "The saved keys can't be read, probably because BETTER_AUTH_SECRET changed. Enter them again."
              : values.hasSecret
                ? "Saved and encrypted. Leave both blank to keep them."
                : "Give these keys read, write and delete on this bucket only. They're stored encrypted."}
          </p>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="pathStyle" defaultChecked={values.pathStyle} className="mt-0.5 size-4 shrink-0 accent-primary" />
          <span className="grid gap-0.5">
            <span>Path-style addresses</span>
            <span className="text-muted-foreground">Usually needed for MinIO and other self-hosted servers.</span>
          </span>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t pt-4">
        <SubmitButton pending={busy && !locked} disabled={locked || busy}>Test and save</SubmitButton>
        <Button type="button" variant="outline" disabled={busy} aria-busy={busy} onClick={() => submit("test")}>
          Test connection
        </Button>
        {state?.ok && <Done>{state.test ? "Connected." : "Saved."} A test file went in and out.</Done>}
        <FormError>{state?.error}</FormError>
      </div>
    </form>
  )
}

// `day` is formatted on the server, so server and browser render the same text.
export type TrendPoint = { day: string; value: number; label: string }

// One measure over recent runs, as thin bars. Hover or focus a bar for its value.
export function Trend({ title, points, peak }: { title: string; points: TrendPoint[]; peak: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(...points.map((p) => p.value), 1)
  const shown = hover ?? points.length - 1
  return (
    <figure className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4">
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">{title}</span>
        {points.length > 0 && (
          <span className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
            {points[shown].label}
            <span className="sr-only">, </span>
            <span className="ml-1.5 text-xs">{hover === null ? "latest" : points[shown].day}</span>
          </span>
        )}
      </figcaption>
      {points.length < 2 ? (
        <p className="grid h-20 place-items-center rounded-md border border-dashed text-xs text-muted-foreground">
          Shows up after a few backups.
        </p>
      ) : (
        <>
          <div className="relative h-20" onMouseLeave={() => setHover(null)}>
            <span className="pointer-events-none absolute top-0 left-0 text-[11px] leading-none text-muted-foreground tabular-nums">
              {peak}
            </span>
            <div className="absolute inset-x-0 top-0 border-t border-dashed border-border" aria-hidden />
            <div className="absolute inset-0 flex items-end justify-end gap-0.5 pt-4" role="list">
              {points.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  role="listitem"
                  aria-label={`${p.day}: ${p.label}`}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  className="group flex h-full max-w-3 min-w-0 flex-1 items-end outline-none"
                >
                  <span
                    className={cn(
                      "block w-full rounded-t-[4px] transition-colors group-focus-visible:ring-2 group-focus-visible:ring-ring",
                      i === shown ? "bg-foreground" : "bg-muted-foreground/45"
                    )}
                    style={{ height: `${Math.max(4, (p.value / max) * 100)}%` }}
                  />
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-between text-[11px] leading-none text-muted-foreground tabular-nums" aria-hidden>
            <span>{points[0].day}</span>
            <span>{points[points.length - 1].day}</span>
          </div>
        </>
      )}
    </figure>
  )
}
