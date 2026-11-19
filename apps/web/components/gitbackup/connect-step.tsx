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
import type { ConnView, Ref, RegistryPick, Saved } from "@/lib/gitbackup/connections"
import { hostBase, type Provider } from "@/lib/gitbackup/refs"
import { cn } from "@/lib/utils"
import { PermChecklist } from "./perm-checklist"
import { ORDER, PROVIDERS, ProviderIcon } from "./providers"
import { SecretsDialog } from "./secrets-dialog"

export const refKey = (r: Ref | null) => (r ? (r.connectionId ? `c:${r.connectionId}` : `r:${r.registryConnectionId}`) : "")

// Pick which git connection a job uses, or add one: a token on GitHub, GitLab, Gitea or Forgejo, "Connect GitHub" (when an admin set it up), or a Registry connection.
export function ConnectStep({ connections, registry, oauth, value, onChange }: { connections: ConnView[]; registry: RegistryPick[]; oauth: boolean; value: Ref | null; onChange: (r: Ref) => void }) {
  const id = useId()
  const [added, setAdded] = useState<ConnView[]>([])
  const [adding, setAdding] = useState(connections.length === 0 && registry.length === 0)
  const [secretToken, setSecretToken] = useState<string | null>(null)
  // What the last save found, kept after the form closes so a missing optional permission still shows.
  const [found, setFound] = useState<{ provider: Provider; r: Saved } | null>(null)
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
              <ProviderIcon provider={c.provider} />
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
              <ProviderIcon provider="github" />
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
          {picked.scopes.length ? `Scopes: ${picked.scopes.join(", ")}. ` : picked.provider === "github" ? "A fine-grained token: it sees only what you gave it. " : picked.provider === "gitlab" ? "" : `${PROVIDERS[picked.provider].label} doesn't list a token's permissions. `}
          {picked.expiresAt ? `Expires ${DAY.format(new Date(picked.expiresAt))}.` : picked.provider === "gitea" || picked.provider === "forgejo" ? "Expiry unknown." : "No expiry."}
          {picked.provider === "github" && picked.scopes.length > 0 && !picked.scopes.some((s) => s === "read:org" || s === "admin:org") && (
            <span className="block">Without the read:org scope, private repos of organizations you belong to may be missing.</span>
          )}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {!adding && (
          <button type="button" onClick={() => (setFound(null), setAdding(true))} className={cn(buttonVariants({ variant: "outline", size: "sm" }), TOUCH)}>
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
      {found?.r.checks && !adding && <PermChecklist provider={found.provider} checks={found.r.checks} fix={found.r.fix} note={found.r.note} link={PROVIDERS[found.provider].link(found.r.host ? hostBase(found.r.host) : "")} />}
      {adding && (
        <TokenForm
          onSaved={(c, token, r) => {
            setFound({ provider: c.provider, r })
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

function TokenForm({ onSaved, onCancel }: { onSaved: (c: ConnView, token: string, r: Saved) => void; onCancel?: () => void }) {
  const id = useId()
  const [provider, setProvider] = useState<Provider>("github")
  const [token, setToken] = useState("")
  const [name, setName] = useState("")
  const [host, setHost] = useState("")
  const [enterprise, setEnterprise] = useState(false)
  const [error, setError] = useState<string>()
  const [result, setResult] = useState<Saved>()
  const [pending, start] = useTransition()
  const P = PROVIDERS[provider]
  const own = provider === "gitea" || provider === "forgejo"
  // GitHub asks first whether it's Enterprise; GitLab's server is optional; Gitea and Forgejo always have one.
  const showHost = provider === "github" ? enterprise : true
  const server = showHost && host.trim() ? (/^https?:\/\//i.test(host.trim()) ? host.trim() : `https://${host.trim()}`).replace(/\/+$/, "") : ""
  const link = P.link(server)
  return (
    <form
      className={cn("grid gap-4", onCancel && "border-t pt-4")}
      onSubmit={(e) => {
        e.preventDefault()
        // In Settings this form sits inside the job's form; React would hand the submit to that one too.
        e.stopPropagation()
        setError(undefined)
        setResult(undefined)
        start(async () => {
          const r = await addToken({ provider, token, name, host: showHost ? host : undefined })
          setResult(r)
          if (r.error || !r.id) return setError(r.error ?? "Couldn't save the token.")
          const c: ConnView = { id: r.id, provider, name: name.trim() || r.account!, account: r.account!, host: r.host ?? null, via: "pat", last4: token.slice(-4), scopes: r.scopes ?? [], expiresAt: r.expiresAt ?? null, jobs: 0 }
          onSaved(c, token, r)
          setToken("")
        })
      }}
    >
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Where are your repos?</legend>
        <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
          {ORDER.map((p) => (
            <label key={p} className={cn(RADIO, "items-start")}>
              <input type="radio" name={`${id}-provider`} className={cn(RADIO_INPUT, "mt-0.5")} checked={provider === p} onChange={() => (setProvider(p), setHost(""), setEnterprise(false), setError(undefined), setResult(undefined))} />
              <span className="grid min-w-0 gap-0.5">
                <span className="flex items-center gap-2 font-medium">
                  <ProviderIcon provider={p} />
                  {PROVIDERS[p].label}
                </span>
                <span className="text-xs text-muted-foreground">{PROVIDERS[p].hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3">
        <div className="grid gap-1">
          <p className="text-sm font-medium">Add a personal access token</p>
          <p className="text-sm text-pretty text-muted-foreground">
            Give it these permissions, nothing more. Nimbus only reads your repos.{" "}
            {link ? (
              <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-sm text-foreground underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                {P.linkText}
                <ArrowSquareOutIcon aria-hidden className="size-3.5" />
              </a>
            ) : (
              <span>Enter the server address to get a link to your token page.</span>
            )}
          </p>
        </div>
        <ul aria-label={`Permissions for a ${P.label} token`} className="divide-y rounded-lg border text-sm">
          {P.need.map((p) => (
            <li key={p.name} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2">
              <span className="font-mono text-xs">{p.name}</span>
              <span className="text-pretty text-muted-foreground">{p.why}</span>
            </li>
          ))}
          {P.push.map((p) => (
            <li key={p.name} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2">
              <span className="font-mono text-xs">{p.name}</span>
              <span className="text-pretty text-muted-foreground">
                <span className="text-foreground">Optional:</span> {p.why}
              </span>
            </li>
          ))}
        </ul>
        <details className="group text-sm">
          <summary className="w-fit cursor-pointer rounded-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50">
            Tips if the token doesn&apos;t work
          </summary>
          <ul className="mt-2 grid list-disc gap-1.5 pl-5 text-pretty text-muted-foreground">
            {P.tips.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </details>
      </div>
      {provider === "github" && (
        <label className="flex min-h-9 items-center gap-2 text-sm">
          <input type="checkbox" className={RADIO_INPUT} checked={enterprise} onChange={(e) => setEnterprise(e.target.checked)} />
          This is a GitHub Enterprise server
        </label>
      )}
      {showHost && (
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-h`}>{provider === "gitlab" ? "Server URL (optional)" : "Server URL"}</Label>
          <Input id={`${id}-h`} value={host} onChange={(e) => setHost(e.target.value)} placeholder={provider === "github" ? "github.example.com" : provider === "gitlab" ? "gitlab.com, or your own server" : "git.example.com"} autoComplete="off" spellCheck={false} className="pointer-coarse:h-11" />
          {provider === "gitlab" && <p className="text-sm text-muted-foreground">Leave blank for gitlab.com.</p>}
        </div>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-t`}>Token</Label>
        <Input id={`${id}-t`} type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} className="font-mono pointer-coarse:h-11" placeholder={P.placeholder} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-n`}>Name (optional)</Label>
        <Input id={`${id}-n`} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={`Defaults to your ${P.label} username`} autoComplete="off" className="pointer-coarse:h-11" />
      </div>
      <FormError>{error}</FormError>
      {result?.checks && <PermChecklist provider={provider} checks={result.checks} fix={result.fix} note={result.note} link={link} />}
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton pending={pending} disabled={!token.trim() || (own && !host.trim()) || (provider === "github" && enterprise && !host.trim())} className={TOUCH}>
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
