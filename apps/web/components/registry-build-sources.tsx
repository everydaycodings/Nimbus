"use client"

import { Dialog } from "@base-ui/react/dialog"
import { Menu } from "@base-ui/react/menu"
import { ArrowRightIcon, ArrowsLeftRightIcon, CheckCircleIcon, GitBranchIcon, GithubLogoIcon, HammerIcon, LockSimpleIcon, MagnifyingGlassIcon, PlugsIcon, TerminalWindowIcon, UploadSimpleIcon } from "@phosphor-icons/react"
import { useRouter } from "next/navigation"
import { useId, useMemo, useState, useTransition } from "react"

import { changeConnection, connectGit, connectGithub, disconnectSource, githubRepos, githubReposVia, useUploadsOnly as uploadsOnly } from "@/app/(app)/registry/build-actions"
import { CopyButton } from "@/components/copy-button"
import { DIALOG_BACKDROP, DIALOG_POPUP, MENU_ITEM } from "@/components/overlay-styles"
import { ExpiryBadge, GithubTokenHelp, ProviderIcon, SecretField, type OwnerOption } from "@/components/registry-connections"
import { Code, Empty, FadeX, Heading, RADIO, RADIO_INPUT, RowMenu, SELECT, Segmented, TOUCH } from "@/components/registry-ui"
import { SubmitButton } from "@/components/submit-button"
import { useNotice } from "@/components/toaster"
import { FormError } from "@/components/two-factor"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ago } from "@/lib/registry/build-view"
import { fits, PROVIDER_LABEL, type Provider } from "@/lib/registry/connection-rules"
import type { ConnectionPick } from "@/lib/registry/connections"
import { cn } from "@/lib/utils"

export type SourceView = {
  kind: "github" | "git" | "upload"
  url: string | null
  hasCredential: boolean
  connection: { id: string; name: string; provider: string } | null
  connectionLost: boolean
  webhookUrl: string | null
  lastDeliveryAt: string | null
}

const CARD =
  "group flex min-h-11 cursor-pointer flex-col items-start gap-1.5 rounded-xl border bg-card p-4 text-left shadow-xs outline-none hover:border-ring/40 hover:bg-accent/30 focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-pressed:border-primary aria-pressed:bg-input/30 aria-pressed:ring-1 aria-pressed:ring-primary"

type Pick = "github" | "git" | "upload"

// What this member can put on the repository: saved connections by kind, and where a new one can be saved.
export type Picks = { github: ConnectionPick[]; git: ConnectionPick[]; owners: OwnerOption[] }

// Nothing connected yet: three ways in, one form open at a time.
export function ConnectSources({ repoId, fullName, scanOn, picks }: { repoId: string; fullName: string; scanOn: boolean; picks: Picks }) {
  const [pick, setPick] = useState<Pick | null>(null)
  const cards: [Pick, React.ComponentType<{ className?: string }>, string, string][] = [
    ["github", GithubLogoIcon, "GitHub", "Pick a repository. Nimbus adds the webhook and reports each result on the commit."],
    ["git", GitBranchIcon, "Any git URL", "Gitea, GitLab, your own server. You add the webhook there."],
    ["upload", TerminalWindowIcon, "Archive or CLI only", "No repository. Upload a .zip or .tar from the web, or send a folder from the command line."],
  ]
  return (
    <div className="flex flex-col gap-6">
      <Empty icon={HammerIcon} title="Build this image automatically">
        <p>Connect where your Dockerfile lives. Nimbus builds on every push or tag that matches a rule and signs the result{scanOn ? ", then scans it" : ""}.</p>
      </Empty>
      <div className="grid gap-3 md:grid-cols-3">
        {cards.map(([id, Icon, title, text]) => (
          <button key={id} type="button" aria-pressed={pick === id} onClick={() => setPick(pick === id ? null : id)} className={CARD}>
            <Icon aria-hidden className="size-6 text-muted-foreground" />
            <span className="text-sm font-semibold">{title}</span>
            <span className="text-sm text-pretty text-muted-foreground">{text}</span>
            <span className="mt-1 flex items-center gap-1 text-sm font-medium">
              {pick === id ? (
                <>
                  <CheckCircleIcon aria-hidden weight="fill" className="size-4 text-brand" />
                  Selected
                </>
              ) : (
                <>
                  Connect
                  <ArrowRightIcon aria-hidden className="size-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
                </>
              )}
            </span>
          </button>
        ))}
      </div>
      {pick === "github" && <GithubForm repoId={repoId} picks={picks} />}
      {pick === "git" && <GitForm repoId={repoId} picks={picks} />}
      {pick === "upload" && <UploadOnly repoId={repoId} fullName={fullName} />}
    </div>
  )
}

const FORM = "grid gap-4 rounded-xl border bg-card p-4 sm:p-5"

type Via = "saved" | "new"

const pickLabel = (c: ConnectionPick) => `${c.name}${c.account ? ` (@${c.account})` : c.host ? ` (${c.host})` : ""}${c.owner === "You" ? "" : ` · ${c.owner}`}`

// "Use a saved connection" or "Use a new token": shared by the GitHub and git forms.
function ViaSwitch({ via, onChange, hasSaved }: { via: Via; onChange: (v: Via) => void; hasSaved: boolean }) {
  if (!hasSaved) return null
  return (
    <FadeX>
      <Segmented
        label="Credential"
        value={via}
        options={[
          ["saved", "Use a saved connection"],
          ["new", "Use a new token"],
        ]}
        onChange={onChange}
      />
    </FadeX>
  )
}

function ConnectionSelect({ id, picks, value, onChange, label = "Connection" }: { id: string; picks: ConnectionPick[]; value: string; onChange: (v: string) => void; label?: string }) {
  const chosen = picks.find((c) => c.id === value)
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={cn(SELECT, "pointer-coarse:h-11")}>
        <option value="">Choose a connection</option>
        {picks.map((c) => (
          <option key={c.id} value={c.id}>
            {pickLabel(c)}
          </option>
        ))}
      </select>
      {chosen && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <ProviderIcon provider={chosen.provider} className="size-4" />
          {PROVIDER_LABEL[chosen.provider]}
          <ExpiryBadge at={chosen.expiresAt} />
        </p>
      )}
    </div>
  )
}

// "Save as a connection for other repositories": on by default; off keeps the secret on this repository alone.
function SaveBox({ id, owners, value, onChange, placeholder }: { id: string; owners: OwnerOption[]; value: SaveState; onChange: (v: SaveState) => void; placeholder: string }) {
  if (!owners.length) return null
  return (
    <div className="grid gap-3">
      <label className="flex min-h-6 w-fit cursor-pointer items-center gap-2.5 text-sm pointer-coarse:min-h-11">
        <input type="checkbox" className={RADIO_INPUT} checked={value.on} onChange={(e) => onChange({ ...value, on: e.target.checked })} />
        Save as a connection for other repositories
      </label>
      {value.on ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-sn`}>Connection name</Label>
            <Input id={`${id}-sn`} value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} maxLength={60} placeholder={placeholder} autoComplete="off" className="pointer-coarse:h-11" />
          </div>
          {owners.length > 1 && (
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-so`}>Owner</Label>
              <select id={`${id}-so`} value={value.namespaceId} onChange={(e) => onChange({ ...value, namespaceId: e.target.value })} className={cn(SELECT, "pointer-coarse:h-11")}>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label === "You" ? "You" : `${o.label} (org)`}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">It stays on this repository only, encrypted. You can save it as a connection later by adding it under Access.</p>
      )}
    </div>
  )
}
type SaveState = { on: boolean; name: string; namespaceId: string }
const initialSave = (owners: OwnerOption[]): SaveState => ({ on: true, name: "", namespaceId: owners[0]?.id ?? "" })
const toSave = (s: SaveState, fallback: string) => (s.on && s.namespaceId ? { name: s.name.trim() || fallback, namespaceId: s.namespaceId } : undefined)

function GithubForm({ repoId, picks }: { repoId: string; picks: Picks }) {
  const router = useRouter()
  const id = useId()
  const [via, setVia] = useState<Via>(picks.github.length ? "saved" : "new")
  const [connectionId, setConnectionId] = useState("")
  const [token, setToken] = useState("")
  const [save, setSave] = useState(() => initialSave(picks.owners))
  const [repos, setRepos] = useState<{ fullName: string; private: boolean; defaultBranch: string }[] | null>(null)
  const [chosen, setChosen] = useState("")
  const [q, setQ] = useState("")
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()
  const shown = useMemo(() => (repos ?? []).filter((r) => r.fullName.toLowerCase().includes(q.trim().toLowerCase())), [repos, q])
  const load = (r: Awaited<ReturnType<typeof githubRepos>>) => {
    if ("error" in r && r.error) return setError(r.error)
    if ("repos" in r) {
      setRepos(r.repos)
      if (!r.repos.length) setError("That token can't see any repositories. Give it access to the one you want to build.")
    }
  }
  const reset = () => (setRepos(null), setChosen(""), setError(undefined))
  const find = () =>
    start(async () => {
      setError(undefined)
      load(await githubRepos(token))
    })
  const pick = (cid: string) => {
    setConnectionId(cid)
    reset()
    if (cid) start(async () => load(await githubReposVia(repoId, cid)))
  }
  return (
    <section className={FORM} aria-label="Connect GitHub">
      <h3 className="text-sm font-semibold">Connect a GitHub repository</h3>
      <ViaSwitch via={via} onChange={(v) => (setVia(v), reset())} hasSaved={picks.github.length > 0} />
      {via === "saved" ? (
        <ConnectionSelect id={`${id}-c`} picks={picks.github} value={connectionId} onChange={pick} />
      ) : (
        <>
          <div className="grid gap-1.5">
            <GithubTokenHelp />
            <p className="text-xs text-pretty text-muted-foreground">Nimbus stores the token encrypted and uses it only for these three things.</p>
          </div>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              find()
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-t`}>Personal access token</Label>
              <Input
                id={`${id}-t`}
                type="password"
                value={token}
                onChange={(e) => (setToken(e.target.value), reset())}
                placeholder="github_pat_…"
                className="font-mono pointer-coarse:h-11"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            {!repos && (
              <SubmitButton pending={pending} disabled={!token.trim()} variant="outline" className={cn("w-fit", TOUCH)}>
                Find my repositories
              </SubmitButton>
            )}
          </form>
          {repos && repos.length > 0 && <SaveBox id={id} owners={picks.owners} value={save} onChange={setSave} placeholder="Defaults to your GitHub account name" />}
        </>
      )}
      {pending && via === "saved" && !repos && <p className="text-sm text-muted-foreground">Loading repositories…</p>}
      {repos && repos.length > 0 && (
        <div className="grid gap-2">
          <div className="relative">
            <MagnifyingGlassIcon aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${repos.length} repositories`} aria-label="Search repositories" className="pl-8 pointer-coarse:h-11" />
          </div>
          <div role="radiogroup" aria-label="Repository" className="grid max-h-64 gap-1.5 overflow-y-auto">
            {shown.length === 0 && <p className="px-1 text-sm text-muted-foreground">No repository matches.</p>}
            {shown.map((r) => (
              <label key={r.fullName} className={RADIO}>
                <input type="radio" name="gh-repo" className={RADIO_INPUT} checked={chosen === r.fullName} onChange={() => setChosen(r.fullName)} />
                <span className="min-w-0 flex-1 truncate font-mono">{r.fullName}</span>
                {r.private && <LockSimpleIcon aria-label="Private" className="size-4 shrink-0 text-muted-foreground" />}
              </label>
            ))}
          </div>
        </div>
      )}
      <FormError>{error}</FormError>
      {repos && repos.length > 0 && (
        <Button
          className={cn("w-fit", TOUCH)}
          disabled={!chosen || pending}
          onClick={() =>
            start(async () => {
              setError(undefined)
              const r = await connectGithub(repoId, via === "saved" ? { repo: chosen, connectionId } : { repo: chosen, token, save: toSave(save, "") })
              if (r.error) return setError(r.error)
              router.refresh()
            })
          }
        >
          {pending ? "Connecting…" : `Connect ${chosen || "repository"}`}
        </Button>
      )}
    </section>
  )
}

function GitForm({ repoId, picks }: { repoId: string; picks: Picks }) {
  const router = useRouter()
  const id = useId()
  const [url, setUrl] = useState("")
  const [via, setVia] = useState<Via>(picks.git.length ? "saved" : "new")
  const [connectionId, setConnectionId] = useState("")
  const [auth, setAuth] = useState<"token" | "ssh">("token")
  const [username, setUsername] = useState("")
  const [token, setToken] = useState("")
  const [sshKey, setSshKey] = useState("")
  const [save, setSave] = useState(() => initialSave(picks.owners))
  const [error, setError] = useState<string>()
  const [done, setDone] = useState<{ webhookUrl: string; webhookSecret: string } | null>(null)
  const [pending, start] = useTransition()
  // A saved SSH key only fits an SSH address, a token an https:// one.
  const usable = url.trim() ? picks.git.filter((c) => fits(c.provider, { kind: "git", url: url.trim() })) : picks.git
  if (done) return <Webhook {...done} onDone={() => router.refresh()} />
  const secret = auth === "token" ? token.trim() : sshKey.trim()
  return (
    <form
      className={FORM}
      aria-label="Connect a git URL"
      onSubmit={(e) => {
        e.preventDefault()
        start(async () => {
          setError(undefined)
          const host = /^https?:\/\//i.test(url) ? url.replace(/^https?:\/\//i, "").split("/")[0] : (/@([\w.-]+)[:/]/.exec(url)?.[1] ?? "git")
          const r = await connectGit(
            repoId,
            via === "saved" ? { url, connectionId } : auth === "token" ? { url, username, token, save: secret ? toSave(save, host) : undefined } : { url, sshKey, save: secret ? toSave(save, `SSH key for ${host}`) : undefined }
          )
          if (r.error || !r.webhookUrl || !r.webhookSecret) return setError(r.error ?? "Couldn't connect.")
          setDone({ webhookUrl: r.webhookUrl, webhookSecret: r.webhookSecret })
        })
      }}
    >
      <h3 className="text-sm font-semibold">Connect any git repository</h3>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-u`}>Clone URL</Label>
        <Input id={`${id}-u`} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://git.example.com/me/app.git" className="font-mono pointer-coarse:h-11" spellCheck={false} autoComplete="off" />
      </div>
      <ViaSwitch via={via} onChange={setVia} hasSaved={picks.git.length > 0} />
      {via === "saved" ? (
        <>
          <ConnectionSelect id={`${id}-c`} picks={usable} value={usable.some((c) => c.id === connectionId) ? connectionId : ""} onChange={setConnectionId} />
          {usable.length === 0 && <p className="text-xs text-muted-foreground">No saved connection fits this address. Use a new token, or save a matching one under Access.</p>}
        </>
      ) : (
        <>
          <div className="grid gap-2">
            <span className="text-sm font-medium">Sign in with</span>
            <Segmented
              label="Sign in with"
              value={auth}
              options={[
                ["token", "Username and token"],
                ["ssh", "SSH key"],
              ]}
              onChange={setAuth}
            />
            <p className="text-xs text-muted-foreground">Leave it blank for a public repository.</p>
          </div>
          {auth === "token" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-n`}>Username (optional)</Label>
                <Input id={`${id}-n`} value={username} onChange={(e) => setUsername(e.target.value)} className="pointer-coarse:h-11" autoComplete="off" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-k`}>Token or password</Label>
                <Input id={`${id}-k`} type="password" value={token} onChange={(e) => setToken(e.target.value)} className="pointer-coarse:h-11" autoComplete="off" />
              </div>
            </div>
          ) : (
            <div className="grid gap-1.5">
              <SecretField id={`${id}-s`} provider="ssh" value={sshKey} onChange={setSshKey} label="Private key" />
              <p className="text-xs text-muted-foreground">Use a deploy key that can read this one repository.</p>
            </div>
          )}
          {secret && <SaveBox id={id} owners={picks.owners} value={save} onChange={setSave} placeholder="Defaults to the server name" />}
        </>
      )}
      <FormError>{error}</FormError>
      <SubmitButton pending={pending} disabled={!url.trim() || (via === "saved" && !connectionId)} className={cn("w-fit", TOUCH)}>
        Connect
      </SubmitButton>
    </form>
  )
}

// Shown once, right after connecting: the secret can't be read again.
function Webhook({ webhookUrl, webhookSecret, onDone }: { webhookUrl: string; webhookSecret: string; onDone: () => void }) {
  return (
    <section className={FORM} aria-label="Webhook details">
      <div className="grid gap-1">
        <h3 className="text-sm font-semibold">Connected. Now add the webhook</h3>
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">
          In your git server, add a webhook for push and tag events. Copy the secret now: Nimbus can&apos;t show it again.
        </p>
      </div>
      <div className="grid gap-3">
        <Field label="Payload URL" value={webhookUrl} />
        <Field label="Secret" value={webhookSecret} />
      </div>
      <ul className="grid gap-1 text-sm text-pretty text-muted-foreground">
        <li>
          <strong className="font-medium text-foreground">Gitea:</strong> Settings, Webhooks, Add webhook, Gitea. Content type JSON, paste the secret, trigger on push events.
        </li>
        <li>
          <strong className="font-medium text-foreground">GitLab:</strong> Settings, Webhooks. Paste the URL, and the secret as the Secret token. Tick Push events and Tag push events.
        </li>
      </ul>
      <Button className={cn("w-fit", TOUCH)} onClick={onDone}>
        I&apos;ve saved the secret
      </Button>
    </section>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <div className="relative">
        <Code copy>{value}</Code>
        <div className="absolute top-2 right-2">
          <CopyButton value={value} label={`Copy ${label.toLowerCase()}`} className={TOUCH} />
        </div>
      </div>
    </div>
  )
}

function UploadOnly({ repoId, fullName }: { repoId: string; fullName: string }) {
  const router = useRouter()
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()
  return (
    <section className={FORM} aria-label="Upload or CLI only">
      <div className="grid gap-1">
        <h3 className="text-sm font-semibold">Build from an archive or the command line</h3>
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">
          From a folder with a Dockerfile, with the Nimbus CLI signed in. You can also upload a .zip or .tar on the Builds tab.
        </p>
      </div>
      <div className="relative">
        <Code copy>{`nimbus registry build . -t ${fullName}:latest`}</Code>
        <div className="absolute top-2 right-2">
          <CopyButton value={`nimbus registry build . -t ${fullName}:latest`} label="Copy the command" className={TOUCH} />
        </div>
      </div>
      <FormError>{error}</FormError>
      <Button
        className={cn("w-fit", TOUCH)}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await uploadsOnly(repoId)
            if (r.error) return setError(r.error)
            router.refresh()
          })
        }
      >
        <UploadSimpleIcon />
        {pending ? "Setting up…" : "Use uploads only"}
      </Button>
    </section>
  )
}

// ---- connected ------------------------------------------------------------------------------------------

export function SourceRow({ repoId, source, canAdmin, picks }: { repoId: string; source: SourceView; canAdmin: boolean; picks: Picks }) {
  const router = useRouter()
  const setNotice = useNotice()
  const id = useId()
  const [asking, setAsking] = useState(false)
  const [changing, setChanging] = useState(false)
  const [next, setNext] = useState("")
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()
  const Icon = source.kind === "github" ? GithubLogoIcon : source.kind === "git" ? GitBranchIcon : TerminalWindowIcon
  const title = source.kind === "github" ? source.url : source.kind === "git" ? source.url : "Archive uploads and the command line"
  const options = (source.kind === "github" ? picks.github : picks.git).filter((c) => source.kind === "github" || !source.url || fits(c.provider, { kind: "git", url: source.url }))
  const changeable = canAdmin && source.kind !== "upload"
  return (
    <section aria-labelledby="source-heading" className="flex flex-col gap-3">
      <Heading id="source-heading" title="Source" hint="Where this repository's builds come from." />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-card px-4 py-3">
        <Icon aria-hidden className="size-6 shrink-0 text-muted-foreground" />
        <div className="grid min-w-0 flex-1 basis-56 gap-0.5">
          <p className="text-sm font-medium break-all">
            {source.kind === "github" && source.url ? (
              <a href={`https://github.com/${source.url}`} target="_blank" rel="noopener noreferrer" className="rounded-sm font-mono underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50">
                {title}
              </a>
            ) : source.kind === "git" ? (
              <span className="font-mono">{title}</span>
            ) : (
              title
            )}
          </p>
          <p suppressHydrationWarning className="text-xs text-muted-foreground">
            {source.kind === "upload" ? "No repository connected" : source.lastDeliveryAt ? `Last webhook ${ago(source.lastDeliveryAt)}` : "No webhook received yet"}
          </p>
          {source.kind !== "upload" && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              {source.connectionLost ? (
                <Badge variant="outline" className="text-destructive">
                  Needs a connection
                </Badge>
              ) : source.connection ? (
                <>
                  <ProviderIcon provider={source.connection.provider as Provider} className="size-3.5" />
                  <span>
                    Uses connection <strong className="font-medium text-foreground">{source.connection.name}</strong>
                  </span>
                </>
              ) : source.hasCredential ? (
                "Uses a token saved on this repository only"
              ) : (
                "No credential, public repository"
              )}
            </p>
          )}
        </div>
        {source.connectionLost && changeable && (
          <Button className={TOUCH} onClick={() => setChanging(true)}>
            Pick a connection
          </Button>
        )}
        {source.kind === "git" && source.webhookUrl && <CopyButton value={source.webhookUrl} label="Copy webhook URL" text="Copy webhook URL" className={TOUCH} />}
        {canAdmin && (
          <RowMenu label="Source options">
            {changeable && (
              <Menu.Item className={MENU_ITEM} onClick={() => setChanging(true)}>
                <ArrowsLeftRightIcon />
                Change connection
              </Menu.Item>
            )}
            <Menu.Item className={cn(MENU_ITEM, "text-destructive [&_svg]:text-destructive")} onClick={() => setAsking(true)}>
              <PlugsIcon />
              Disconnect
            </Menu.Item>
          </RowMenu>
        )}
      </div>
      {source.connectionLost && (
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">
          The connection for this repository was removed. Builds fail until you pick another one.
        </p>
      )}
      <Dialog.Root open={changing} onOpenChange={(o) => !o && !pending && setChanging(false)}>
        <Dialog.Portal>
          <Dialog.Backdrop className={DIALOG_BACKDROP} />
          <Dialog.Popup className={DIALOG_POPUP}>
            <div className="grid gap-1.5">
              <Dialog.Title className="text-base font-semibold">{source.connectionLost ? "Pick a connection" : "Change connection"}</Dialog.Title>
              <Dialog.Description className="text-sm text-pretty text-muted-foreground">
                Builds and commit statuses use the new one from now on. The webhook and your rules stay as they are.
              </Dialog.Description>
            </div>
            {options.length ? (
              <ConnectionSelect id={`${id}-ch`} picks={options} value={next} onChange={setNext} />
            ) : (
              <p className="text-sm text-pretty text-muted-foreground">
                You have no saved connection that fits. Add one under Registry, Access, Connections, then come back.
              </p>
            )}
            <FormError>{error}</FormError>
            <div className="flex justify-end gap-2">
              <Dialog.Close disabled={pending} render={<Button variant="outline" className={TOUCH} />}>
                Cancel
              </Dialog.Close>
              <Button
                className={TOUCH}
                disabled={pending || !next || next === source.connection?.id}
                onClick={() =>
                  start(async () => {
                    setError(undefined)
                    const r = await changeConnection(repoId, next)
                    if (r.error) return setError(r.error)
                    setChanging(false)
                    setNotice({ text: "Connection changed." })
                    router.refresh()
                  })
                }
              >
                {pending ? "Saving…" : "Use this connection"}
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={asking} onOpenChange={(o) => !o && !pending && setAsking(false)}>
        <Dialog.Portal>
          <Dialog.Backdrop className={DIALOG_BACKDROP} />
          <Dialog.Popup className={DIALOG_POPUP}>
            <div className="grid gap-1.5">
              <Dialog.Title className="text-base font-semibold">Disconnect this source?</Dialog.Title>
              <Dialog.Description className="text-sm text-pretty text-muted-foreground">
                {source.kind === "github" ? "The webhook is removed from GitHub. " : ""}Your build rules are kept, and finished builds and their images stay. Nothing builds until you connect a source again.
              </Dialog.Description>
            </div>
            <FormError>{error}</FormError>
            <div className="flex justify-end gap-2">
              <Dialog.Close disabled={pending} render={<Button variant="outline" className={TOUCH} />}>
                Keep
              </Dialog.Close>
              <Button
                variant="destructive"
                className={TOUCH}
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await disconnectSource(repoId)
                    if (r.error) return setError(r.error)
                    setAsking(false)
                    setNotice({ text: "Disconnected." })
                    router.refresh()
                  })
                }
              >
                Disconnect
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  )
}
