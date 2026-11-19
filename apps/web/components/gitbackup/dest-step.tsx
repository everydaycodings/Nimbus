"use client"

import { CheckCircleIcon } from "@phosphor-icons/react"
import { useEffect, useId, useState, useTransition } from "react"

import { nimbusOptions, testS3 } from "@/app/(app)/more/github-backup/actions"
import { RADIO, RADIO_INPUT, SELECT, TOUCH, Switch } from "@/components/registry-ui"
import { FormError } from "@/components/two-factor"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { DestInput } from "@/lib/gitbackup/setup"
import { bucketNameError, suggestBucketName } from "@/lib/s3api/rules"
import { cn } from "@/lib/utils"

type Opts = Awaited<ReturnType<typeof nimbusOptions>>
export type Existing = { endpoint: string; region: string; bucket: string; accessKey: string; pathStyle: boolean }

const NOT_READY: Record<string, string> = {
  unset: "S3 isn't set up on this server.",
  off: "An admin turned the S3 API off.",
  disabled: "S3 is off for your account.",
}

// Where archives go. onChange gets the destination when it is complete (a tested manual S3 counts only after "Test connection" passes), else null.
// `existing`: editing a manual S3 job; a blank secret keeps the stored one.
export function DestStep({ onChange, existing, jobName }: { onChange: (d: DestInput | null) => void; existing?: Existing; jobName?: string }) {
  const id = useId()
  const [kind, setKind] = useState<"nimbus" | "s3">(existing ? "s3" : "nimbus")
  const [opts, setOpts] = useState<Opts | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [mode, setMode] = useState<"existing" | "new">("new")
  const [bucketId, setBucketId] = useState("")
  const [newBucket, setNewBucket] = useState(suggestBucketName(jobName || "git backup"))
  const [s3, setS3] = useState({ endpoint: existing?.endpoint ?? "", region: existing?.region ?? "us-east-1", bucket: existing?.bucket ?? "", accessKey: existing?.accessKey ?? "", secret: "", pathStyle: existing?.pathStyle ?? true })
  // The values the last passing test was for.
  const [tested, setTested] = useState<string | null>(null)
  const [testing, start] = useTransition()
  const [error, setError] = useState<string>()
  const sig = JSON.stringify(s3)

  useEffect(() => {
    nimbusOptions().then(
      (o) => {
        setOpts(o)
        if (o.buckets.length) {
          setMode("existing")
          setBucketId(o.buckets[0].id)
        }
        if (o.state !== "ready") setKind("s3")
      },
      () => (setLoadError(true), setKind("s3"))
    )
  }, [])

  const bucketBad = mode === "new" ? bucketNameError(newBucket.trim()) : null
  useEffect(() => {
    if (kind === "nimbus") onChange(opts?.state === "ready" && (mode === "existing" ? bucketId : newBucket.trim() && !bucketBad) ? (mode === "existing" ? { kind, bucketId } : { kind, newBucket: newBucket.trim() }) : null)
    else onChange(tested === sig ? { kind: "s3", ...s3 } : null)
    // onChange is the parent's setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, opts, mode, bucketId, newBucket, bucketBad, tested, sig])

  const ready = opts?.state === "ready"
  const full = s3.endpoint.trim() && s3.bucket.trim() && s3.accessKey.trim() && (s3.secret || existing)
  const set = (p: Partial<typeof s3>) => setS3((v) => ({ ...v, ...p }))
  const field = (key: "endpoint" | "region" | "bucket" | "accessKey", label: string, ph: string, mono = true) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`${id}-${key}`}>{label}</Label>
      <Input id={`${id}-${key}`} value={s3[key]} onChange={(e) => set({ [key]: e.target.value })} placeholder={ph} autoComplete="off" spellCheck={false} className={cn(mono && "font-mono", "pointer-coarse:h-11")} />
    </div>
  )
  return (
    <div className="flex flex-col gap-4">
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="sr-only">Storage</legend>
        <label className={cn(RADIO, "items-start", !ready && opts && "opacity-60")}>
          <input type="radio" name={`${id}-kind`} className={cn(RADIO_INPUT, "mt-0.5")} checked={kind === "nimbus"} disabled={!ready} onChange={() => setKind("nimbus")} />
          <span className="grid gap-0.5">
            <span className="font-medium">Nimbus S3</span>
            <span className="text-muted-foreground">A bucket on this server, with a key made only for this job.</span>
          </span>
        </label>
        <label className={cn(RADIO, "items-start")}>
          <input type="radio" name={`${id}-kind`} className={cn(RADIO_INPUT, "mt-0.5")} checked={kind === "s3"} onChange={() => setKind("s3")} />
          <span className="grid gap-0.5">
            <span className="font-medium">Another S3</span>
            <span className="text-muted-foreground">AWS, Backblaze, MinIO or any S3-compatible storage.</span>
          </span>
        </label>
      </fieldset>
      {!opts && !loadError && <div aria-hidden className="h-9 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />}
      {opts && !ready && <p className="text-sm text-pretty text-muted-foreground">{NOT_READY[opts.state]} Use Another S3 instead.</p>}
      {loadError && <p className="text-sm text-pretty text-muted-foreground">Couldn&apos;t check this server&apos;s S3. Use Another S3, or reload the page.</p>}

      {kind === "nimbus" && ready && (
        <div className="grid gap-3">
          {opts.buckets.length > 0 && (
            <fieldset className="grid gap-2 sm:grid-cols-2">
              <legend className="sr-only">Bucket</legend>
              <label className={RADIO}>
                <input type="radio" name={`${id}-mode`} className={RADIO_INPUT} checked={mode === "existing"} onChange={() => setMode("existing")} />
                Use an existing bucket
              </label>
              <label className={RADIO}>
                <input type="radio" name={`${id}-mode`} className={RADIO_INPUT} checked={mode === "new"} onChange={() => setMode("new")} />
                Make a new bucket
              </label>
            </fieldset>
          )}
          {mode === "existing" ? (
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-b`}>Bucket</Label>
              <select id={`${id}-b`} value={bucketId} onChange={(e) => setBucketId(e.target.value)} className={cn(SELECT, "pointer-coarse:h-11")}>
                {opts.buckets.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-nb`}>New bucket name</Label>
              <Input id={`${id}-nb`} value={newBucket} onChange={(e) => setNewBucket(e.target.value)} autoComplete="off" spellCheck={false} className="font-mono pointer-coarse:h-11" aria-invalid={Boolean(newBucket && bucketBad) || undefined} />
              {newBucket && bucketBad && <p className="text-sm text-destructive">{bucketBad}</p>}
            </div>
          )}
          <p className="text-sm text-pretty text-muted-foreground">Nimbus makes an access key called “Git Backup — {jobName || "job name"}” that can reach only this bucket. You&apos;ll see it under S3 buckets.</p>
        </div>
      )}

      {kind === "s3" && (
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {field("endpoint", "Endpoint", "https://s3.example.com")}
            {field("region", "Region", "us-east-1")}
            {field("bucket", "Bucket", "my-backups")}
            {field("accessKey", "Access key ID", "AKIA…")}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-secret`}>Secret access key</Label>
            <Input id={`${id}-secret`} type="password" value={s3.secret} onChange={(e) => set({ secret: e.target.value })} autoComplete="off" spellCheck={false} placeholder={existing ? "••••••••" : ""} className="font-mono pointer-coarse:h-11" />
            {existing && <p className="text-sm text-muted-foreground">Leave blank to keep it.</p>}
          </div>
          <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 rounded-lg border px-3 py-2.5 text-sm">
            <span className="grid gap-0.5">
              <span className="font-medium">Path-style addressing</span>
              <span className="text-muted-foreground">On for MinIO and most self-hosted storage; off for AWS.</span>
            </span>
            <Switch checked={s3.pathStyle} onChange={(e) => set({ pathStyle: e.target.checked })} />
          </label>
          <FormError>{error}</FormError>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              className={TOUCH}
              disabled={testing || !full}
              onClick={() =>
                start(async () => {
                  setError(undefined)
                  // A blank secret on an existing job keeps the stored one; the server tests it on save.
                  if (!s3.secret) return setTested(sig)
                  const r = await testS3({ kind: "s3", ...s3 })
                  if (r.error) return (setTested(null), setError(r.error))
                  setTested(sig)
                })
              }
            >
              {testing ? "Testing…" : "Test connection"}
            </Button>
            {tested === sig && (
              <p role="status" className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <CheckCircleIcon aria-hidden className="size-4 text-brand" />
                {s3.secret ? "Wrote, read and deleted a test file." : "Looks complete. It is tested when you save."}
              </p>
            )}
          </div>
          {!existing && tested !== sig && <p className="text-sm text-muted-foreground">Test the connection before continuing.</p>}
        </div>
      )}
    </div>
  )
}
