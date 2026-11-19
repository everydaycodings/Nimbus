"use client"

import { useRouter } from "next/navigation"
import { useId, useState, useTransition } from "react"

import { renameBucket, setQuiet, unmarkBucket } from "@/app/(app)/buckets/actions"
import { QUIET_HINT } from "@/components/s3-bucket-dialog"
import { Confirm, Heading, SECTION, Switch } from "@/components/registry-ui"
import { SubmitButton } from "@/components/submit-button"
import { useNotice } from "@/components/toaster"
import { FormError } from "@/components/two-factor"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SettingsCors } from "@/components/buckets/settings-cors"
import { SettingsLifecycle } from "@/components/buckets/settings-lifecycle"
import { SettingsPublic } from "@/components/buckets/settings-public"
import { SettingsQuota } from "@/components/buckets/settings-quota"
import type { BucketConfig } from "@/lib/s3api/bucket-config"
import type { BucketRow } from "@/lib/s3api/manage"
import { bucketNameError } from "@/lib/s3api/rules"

export function DetailSettings({ b, c, admin }: { b: BucketRow; c: BucketConfig; admin: boolean }) {
  const router = useRouter()
  const setNotice = useNotice()
  const id = useId()
  const [quiet, setLocal] = useState(b.quiet)
  const [name, setName] = useState(b.name)
  const [error, setError] = useState<string>()
  const [quietPending, startQuiet] = useTransition()
  const [renaming, startRename] = useTransition()
  const [stopping, startStop] = useTransition()
  const trimmed = name.trim()
  const hint = trimmed && trimmed !== b.name ? bucketNameError(trimmed) : null

  return (
    <div className="flex flex-col gap-8">
      <section className={SECTION} aria-labelledby="quiet-heading">
        <Heading id="quiet-heading" title="Quiet" hint={QUIET_HINT} />
        <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3">
          <Switch
            id={`${id}-quiet`}
            checked={quiet}
            disabled={quietPending}
            onChange={(e) => {
              const next = e.target.checked
              setLocal(next)
              setError(undefined)
              startQuiet(async () => {
                const r = await setQuiet(b.id, next)
                if (r.error) {
                  setLocal(!next)
                  setError(r.error)
                }
              })
            }}
          />
          <Label htmlFor={`${id}-quiet`} className="cursor-pointer">
            Keep files that arrive over S3 quiet
          </Label>
        </div>
      </section>

      <SettingsQuota key={`${c.quotaBytes}`} bucketId={b.id} c={c} />
      <SettingsLifecycle bucketId={b.id} rules={c.lifecycle} run={c.lastRun} />
      <SettingsCors bucketId={b.id} rules={c.cors} />
      <SettingsPublic bucketId={b.id} c={c} admin={admin} />

      <section className={SECTION} aria-labelledby="rename-heading">
        <Heading
          id="rename-heading"
          title="Rename"
          hint="Apps that use the old name stop working until you change them to the new one. The files don't move."
        />
        <form
          className="grid gap-3 rounded-xl border bg-card p-4"
          onSubmit={(e) => {
            e.preventDefault()
            setError(undefined)
            startRename(async () => {
              const r = await renameBucket(b.id, trimmed)
              const to = "name" in r ? r.name : undefined
              if (r.error || !to) return setError(r.error ?? "Couldn't rename it.")
              setNotice({ text: `Renamed to “${to}”. Update any apps that used “${b.name}”.` })
              router.replace(`/buckets/${to}?tab=settings`)
            })
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor={`${id}-name`}>Bucket name</Label>
            <Input
              id={`${id}-name`}
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase())}
              maxLength={63}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={hint ? true : undefined}
              aria-describedby={`${id}-name-hint`}
              className="font-mono"
            />
            <p id={`${id}-name-hint`} className="min-h-5 text-sm text-destructive">
              {hint}
            </p>
          </div>
          <div>
            <SubmitButton pending={renaming} disabled={!trimmed || trimmed === b.name || Boolean(hint)}>
              Rename bucket
            </SubmitButton>
          </div>
        </form>
        <FormError>{error}</FormError>
      </section>

      <section className={SECTION} aria-labelledby="danger-heading">
        <Heading id="danger-heading" title="Danger zone" hint="Files stay where they are. Apps lose this bucket." />
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/40 px-4 py-3">
          <p className="text-sm">Stop using this folder as a bucket.</p>
          <Confirm
            label="Stop using"
            question="The folder becomes a normal folder again."
            yes="Stop using"
            pending={stopping}
            onYes={() =>
              startStop(async () => {
                const r = await unmarkBucket(b.id)
                if (r.error) return setError(r.error)
                setNotice({ text: `“${b.name}” is a normal folder again.` })
                router.replace("/buckets?tab=buckets")
              })
            }
          />
        </div>
      </section>
    </div>
  )
}
