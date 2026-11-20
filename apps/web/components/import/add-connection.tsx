"use client"

import { useId, useState, useTransition } from "react"

import { addConnection } from "@/app/(app)/more/import/actions"
import { CopyButton } from "@/components/copy-button"
import { RADIO, RADIO_INPUT, TOUCH } from "@/components/registry-ui"
import { SubmitButton } from "@/components/submit-button"
import { FormError } from "@/components/two-factor"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { NewConnection } from "@/lib/import/connections"
import type { Provider } from "@/lib/import/rules"
import { cn } from "@/lib/utils"
import { AUTHORIZE, label, ORDER, ProviderIcon } from "./providers"

export type Ready = Record<"gdrive" | "gphotos" | "dropbox" | "onedrive", boolean>

const FIELD = "pointer-coarse:h-11"
const TEXTAREA = "w-full rounded-lg border border-input bg-input/30 px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"

// Adds a source: a Connect button when an admin set up the service's OAuth app, otherwise a token pasted from `rclone authorize`;
// S3, WebDAV and SFTP take their credentials. The connection must work (rclone can list it) before it is saved.
export function AddConnection({ oauth, onAdded, onCancel }: { oauth: Ready; onAdded: (id: string) => void; onCancel?: () => void }) {
  const id = useId()
  const [provider, setProvider] = useState<Provider>("gdrive")
  const [v, setV] = useState<Record<string, string>>({})
  const [paste, setPaste] = useState(false)
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV((o) => ({ ...o, [k]: e.target.value }))
  const cloud = provider === "gdrive" || provider === "gphotos" || provider === "dropbox" || provider === "onedrive"
  const button = cloud && oauth[provider]
  const showToken = cloud && (!button || paste)

  const body = (): NewConnection => {
    const label = v.label?.trim() || undefined
    if (cloud) return { provider, label, token: v.token ?? "" }
    if (provider === "s3") return { provider, label, endpoint: v.endpoint ?? "", region: v.region, accessKey: v.accessKey ?? "", secretKey: v.secretKey ?? "", bucket: v.bucket }
    if (provider === "webdav") return { provider, label, url: v.url ?? "", user: v.user, password: v.password }
    return { provider: "sftp", label, host: v.host ?? "", port: Number(v.port) || 22, user: v.user ?? "", password: v.password, privateKey: v.privateKey }
  }
  const ready = cloud ? (button && !paste ? false : Boolean(v.token?.trim())) : provider === "s3" ? Boolean(v.endpoint && v.accessKey && v.secretKey) : provider === "webdav" ? Boolean(v.url) : Boolean(v.host && v.user && (v.password || v.privateKey))

  return (
    <form
      className="flex flex-col gap-4 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault()
        setError(undefined)
        start(async () => {
          const r = await addConnection(body())
          if ("error" in r && r.error) return setError(r.error)
          onAdded((r as { id: string }).id)
        })
      }}
    >
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Where are your files?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {ORDER.map((p) => (
            <label key={p} className={RADIO}>
              <input type="radio" name={`${id}-p`} className={RADIO_INPUT} checked={provider === p} onChange={() => (setProvider(p), setError(undefined))} />
              <ProviderIcon provider={p} />
              {label(p)}
            </label>
          ))}
        </div>
      </fieldset>

      {button && (
        <div className="grid gap-2">
          <a href={`/api/import/oauth/start?provider=${provider}`} className={cn(buttonVariants(), TOUCH, "w-fit")}>Connect {label(provider)}</a>
          <p className="text-sm text-pretty text-muted-foreground">You sign in on {label(provider)}&apos;s own page and Nimbus gets read-only access to your files. You can leave this page; you come back here when it is done.</p>
          {!paste && (
            <button type="button" className="w-fit rounded-sm text-sm underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" onClick={() => setPaste(true)}>
              Paste a token instead
            </button>
          )}
        </div>
      )}
      {showToken && (
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-token`}>Token from rclone</Label>
          <p className="text-sm text-pretty text-muted-foreground">
            On a computer with <a href="https://rclone.org/downloads/" target="_blank" rel="noreferrer" className="underline underline-offset-4">rclone</a> installed, run the command below, sign in to {label(provider)} in the window that opens, and paste what rclone prints.
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border bg-input/20 px-3 py-2 font-mono text-sm">rclone authorize &quot;{AUTHORIZE[provider]}&quot;</code>
            <CopyButton value={`rclone authorize "${AUTHORIZE[provider]}"`} label="Copy the command" />
          </div>
          <textarea id={`${id}-token`} value={v.token ?? ""} onChange={set("token")} rows={4} placeholder='{"access_token":"…","refresh_token":"…"}' spellCheck={false} autoComplete="off" className={cn(TEXTAREA, "font-mono text-xs")} />
        </div>
      )}

      {provider === "s3" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id={`${id}-endpoint`} label="Endpoint" value={v.endpoint} onChange={set("endpoint")} placeholder="https://s3.example.com" mono className="sm:col-span-2" />
          <Field id={`${id}-bucket`} label="Bucket (optional)" value={v.bucket} onChange={set("bucket")} placeholder="my-bucket" mono />
          <Field id={`${id}-region`} label="Region (optional)" value={v.region} onChange={set("region")} placeholder="us-east-1" mono />
          <Field id={`${id}-ak`} label="Access key" value={v.accessKey} onChange={set("accessKey")} mono />
          <Field id={`${id}-sk`} label="Secret key" value={v.secretKey} onChange={set("secretKey")} type="password" mono />
          <p className="text-sm text-pretty text-muted-foreground sm:col-span-2">Leave the bucket empty to list every bucket the key can see. Pick a bucket if the key can&apos;t list them.</p>
        </div>
      )}
      {provider === "webdav" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id={`${id}-url`} label="WebDAV address" value={v.url} onChange={set("url")} placeholder="https://dav.example.com/files" mono className="sm:col-span-2" />
          <Field id={`${id}-user`} label="User name (optional)" value={v.user} onChange={set("user")} />
          <Field id={`${id}-pass`} label="Password (optional)" value={v.password} onChange={set("password")} type="password" />
          <p className="text-sm text-pretty text-muted-foreground sm:col-span-2">For another Nimbus, use its /api/dav address with an app password.</p>
        </div>
      )}
      {provider === "sftp" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id={`${id}-host`} label="Host" value={v.host} onChange={set("host")} placeholder="files.example.com" mono />
          <Field id={`${id}-port`} label="Port" value={v.port} onChange={set("port")} placeholder="22" inputMode="numeric" />
          <Field id={`${id}-suser`} label="User name" value={v.user} onChange={set("user")} />
          <Field id={`${id}-spass`} label="Password" value={v.password} onChange={set("password")} type="password" />
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor={`${id}-key`}>Or a private key</Label>
            <textarea id={`${id}-key`} value={v.privateKey ?? ""} onChange={set("privateKey")} rows={4} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" spellCheck={false} autoComplete="off" className={cn(TEXTAREA, "font-mono text-xs")} />
            <p className="text-sm text-pretty text-muted-foreground">Use a password or a key without a passphrase. Nimbus only reads from the server.</p>
          </div>
        </div>
      )}
      <Field id={`${id}-label`} label="Name (optional)" value={v.label} onChange={set("label")} placeholder={label(provider)} maxLength={60} />
      <FormError>{error}</FormError>
      <div className="flex flex-wrap gap-2">
        <SubmitButton pending={pending} disabled={!ready} className={TOUCH}>Check and save</SubmitButton>
        {onCancel && <Button type="button" variant="ghost" className={TOUCH} disabled={pending} onClick={onCancel}>Cancel</Button>}
      </div>
      {pending && <p role="status" className="text-sm text-muted-foreground">Checking that Nimbus can list your files…</p>}
    </form>
  )
}

function Field({ id, label, className, mono, ...p }: React.ComponentProps<typeof Input> & { id: string; label: string; mono?: boolean }) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} autoComplete="off" spellCheck={false} {...p} value={p.value ?? ""} className={cn(FIELD, mono && "font-mono")} />
    </div>
  )
}
