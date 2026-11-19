"use client"

import { ArrowSquareOutIcon, GithubLogoIcon, PlusIcon } from "@phosphor-icons/react"
import { useId, useState, useTransition } from "react"

import { addToken } from "@/app/(app)/more/github-backup/actions"
import { ExpiryBadge } from "@/components/registry-connections"
import { DAY, RADIO, RADIO_INPUT, TOUCH } from "@/components/registry-ui"
import { SubmitButton } from "@/components/submit-button"
import { FormError } from "@/components/two-factor"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { ConnView, Ref, RegistryPick } from "@/lib/gitbackup/connections"
import { cn } from "@/lib/utils"
import { SecretsDialog } from "./secrets-dialog"

const TOKEN_URL = "https://github.com/settings/tokens/new?scopes=repo,read:org&description=Nimbus%20Git%20Backup"
export const refKey = (r: Ref | null) => (r ? (r.connectionId ? `c:${r.connectionId}` : `r:${r.registryConnectionId}`) : "")

// Pick which GitHub connection a job uses, or add one: a token, "Connect GitHub" (when an admin set it up), or a Registry connection.
export function ConnectStep({ connections, registry, oauth, value, onChange }: { connections: ConnView[]; registry: RegistryPick[]; oauth: boolean; value: Ref | null; onChange: (r: Ref) => void }) {
  const id = useId()
  const [added, setAdded] = useState<ConnView[]>([])
  const [adding, setAdding] = useState(connections.length === 0 && registry.length === 0)
  const [secretToken, setSecretToken] = useState<string | null>(null)
  const all = [...connections, ...added.filter((a) => !connections.some((c) => c.id === a.id))]
  const picked = all.find((c) => refKey(value) === `c:${c.id}`)
  return (
    <div className="flex flex-col gap-4">
      {(all.length > 0 || registry.length > 0) && (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">Use a connection</legend>
          {all.map((c) => (
            <label key={c.id} className={RADIO}>
              <input type="radio" name={`${id}-conn`} className={RADIO_INPUT} checked={refKey(value) === `c:${c.id}`} onChange={() => onChange({ connectionId: c.id })} />
              <GithubLogoIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate" title={c.name}>
                {c.name}
                <span className="text-muted-foreground">{c.account && c.account !== c.name ? ` · ${c.account}` : ""}{c.host ? ` · ${c.host}` : ""}</span>
              </span>
              <ExpiryBadge at={c.expiresAt} />
            </label>
          ))}
          {registry.map((c) => (
            <label key={c.id} className={RADIO}>
              <input type="radio" name={`${id}-conn`} className={RADIO_INPUT} checked={refKey(value) === `r:${c.id}`} onChange={() => onChange({ registryConnectionId: c.id })} />
              <GithubLogoIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate" title={c.name}>
                {c.name}
                <span className="text-muted-foreground">{c.account ? ` · ${c.account}` : ""}</span>
              </span>
              <Badge variant="outline">Registry</Badge>
              <ExpiryBadge at={c.expiresAt} />
            </label>
          ))}
        </fieldset>
      )}
      {picked && (
        <p role="status" className="text-sm text-pretty text-muted-foreground">
          {picked.account ? `Signed in as ${picked.account}. ` : ""}
          {picked.scopes.length ? `Scopes: ${picked.scopes.join(", ")}. ` : "A fine-grained token: it sees only what you gave it. "}
          {picked.expiresAt ? `Expires ${DAY.format(new Date(picked.expiresAt))}.` : "No expiry."}
          {picked.scopes.length > 0 && !picked.scopes.some((s) => s === "read:org" || s === "admin:org") && (
            <span className="block">Without the read:org scope, private repos of organizations you belong to may be missing.</span>
          )}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} className={cn(buttonVariants({ variant: "outline", size: "sm" }), TOUCH)}>
            <PlusIcon />
            Add a token
          </button>
        )}
        {oauth && (
          <a href="/api/gitbackup/oauth/start" className={cn(buttonVariants({ variant: "outline", size: "sm" }), TOUCH)}>
            <GithubLogoIcon />
            Connect GitHub
          </a>
        )}
      </div>
      {adding && (
        <TokenForm
          onSaved={(c, token) => {
            setAdded((a) => [...a, c])
            setAdding(false)
            onChange({ connectionId: c.id })
            setSecretToken(token)
          }}
          onCancel={all.length || registry.length ? () => setAdding(false) : undefined}
        />
      )}
      <SecretsDialog token={secretToken} onClose={() => setSecretToken(null)} />
    </div>
  )
}

function TokenForm({ onSaved, onCancel }: { onSaved: (c: ConnView, token: string) => void; onCancel?: () => void }) {
  const id = useId()
  const [token, setToken] = useState("")
  const [name, setName] = useState("")
  const [host, setHost] = useState("")
  const [enterprise, setEnterprise] = useState(false)
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()
  return (
    <form
      className={cn("grid gap-4", onCancel && "border-t pt-4")}
      onSubmit={(e) => {
        e.preventDefault()
        // In Settings this form sits inside the job's form; React would hand the submit to that one too.
        e.stopPropagation()
        setError(undefined)
        start(async () => {
          const r = await addToken({ token, name, host: enterprise ? host : undefined })
          if (r.error || !r.id) return setError(r.error ?? "Couldn't save the token.")
          const c: ConnView = { id: r.id, provider: "github", name: name.trim() || r.account!, account: r.account!, host: enterprise && host.trim() ? host.trim() : null, via: "pat", last4: token.slice(-4), scopes: r.scopes ?? [], expiresAt: r.expiresAt ?? null, jobs: 0 }
          onSaved(c, token)
          setToken("")
        })
      }}
    >
      <div className="grid gap-1">
        <p className="text-sm font-medium">Add a personal access token</p>
        <p className="text-sm text-pretty text-muted-foreground">
          It needs the <span className="font-mono">repo</span> and <span className="font-mono">read:org</span> scopes to see private and organization repos.{" "}
          <a href={TOKEN_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-sm text-foreground underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
            Create one on GitHub
            <ArrowSquareOutIcon aria-hidden className="size-3.5" />
          </a>
        </p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-t`}>Token</Label>
        <Input id={`${id}-t`} type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} className="font-mono pointer-coarse:h-11" placeholder="ghp_…" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-n`}>Name (optional)</Label>
        <Input id={`${id}-n`} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Defaults to your GitHub username" autoComplete="off" className="pointer-coarse:h-11" />
      </div>
      <label className="flex min-h-9 items-center gap-2 text-sm">
        <input type="checkbox" className={RADIO_INPUT} checked={enterprise} onChange={(e) => setEnterprise(e.target.checked)} />
        This is a GitHub Enterprise server
      </label>
      {enterprise && (
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-h`}>Server address</Label>
          <Input id={`${id}-h`} value={host} onChange={(e) => setHost(e.target.value)} placeholder="github.example.com" autoComplete="off" spellCheck={false} className="pointer-coarse:h-11" />
        </div>
      )}
      <FormError>{error}</FormError>
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton pending={pending} disabled={!token.trim() || (enterprise && !host.trim())} className={TOUCH}>
          Check and save
        </SubmitButton>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={pending} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), TOUCH)}>
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}
