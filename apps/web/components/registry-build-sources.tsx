"use client"

import { Dialog } from "@base-ui/react/dialog"
import { Menu } from "@base-ui/react/menu"
import { GitBranchIcon, GithubLogoIcon, HammerIcon, LockSimpleIcon, MagnifyingGlassIcon, PlugsIcon, TerminalWindowIcon, UploadSimpleIcon } from "@phosphor-icons/react"
import { useRouter } from "next/navigation"
import { useId, useMemo, useState, useTransition } from "react"

import { connectGit, connectGithub, disconnectSource, githubRepos, useUploadsOnly as uploadsOnly } from "@/app/(app)/registry/build-actions"
import { CopyButton } from "@/components/copy-button"
import { DIALOG_BACKDROP, DIALOG_POPUP, MENU_ITEM } from "@/components/overlay-styles"
import { Code, Empty, Heading, RADIO, RADIO_INPUT, RowMenu, Segmented, TOUCH } from "@/components/registry-ui"
import { SubmitButton } from "@/components/submit-button"
import { useNotice } from "@/components/toaster"
import { FormError } from "@/components/two-factor"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ago } from "@/lib/registry/build-view"
import { cn } from "@/lib/utils"

export type SourceView = {
  kind: "github" | "git" | "upload"
  url: string | null
  hasCredential: boolean
  webhookUrl: string | null
  lastDeliveryAt: string | null
}

const CARD =
  "flex min-h-11 cursor-pointer flex-col items-start gap-1.5 rounded-xl border bg-card p-4 text-left outline-none hover:bg-accent/30 focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-pressed:border-ring/60 aria-pressed:bg-input/30"

type Pick = "github" | "git" | "upload"

// Nothing connected yet: three ways in, one form open at a time.
export function ConnectSources({ repoId, fullName }: { repoId: string; fullName: string }) {
  const [pick, setPick] = useState<Pick | null>(null)
  const cards: [Pick, React.ComponentType<{ className?: string }>, string, string][] = [
    ["github", GithubLogoIcon, "GitHub", "Pick a repository. Nimbus adds the webhook and reports each result on the commit."],
    ["git", GitBranchIcon, "Any git URL", "Gitea, GitLab, your own server. You add the webhook there."],
    ["upload", TerminalWindowIcon, "Upload or CLI only", "No repository. Send a folder from the web or the command line."],
  ]
  return (
    <div className="flex flex-col gap-6">
      <Empty icon={HammerIcon} title="Build this image automatically">
        <p>Connect where your Dockerfile lives. Nimbus builds on every push or tag that matches a rule, signs the result and scans it.</p>
      </Empty>
      <div className="grid gap-3 md:grid-cols-3">
        {cards.map(([id, Icon, title, text]) => (
          <button key={id} type="button" aria-pressed={pick === id} onClick={() => setPick(pick === id ? null : id)} className={CARD}>
            <Icon aria-hidden className="size-6 text-muted-foreground" />
            <span className="text-sm font-semibold">{title}</span>
            <span className="text-sm text-pretty text-muted-foreground">{text}</span>
          </button>
        ))}
      </div>
      {pick === "github" && <GithubForm repoId={repoId} />}
      {pick === "git" && <GitForm repoId={repoId} />}
      {pick === "upload" && <UploadOnly repoId={repoId} fullName={fullName} />}
    </div>
  )
}

const FORM = "grid gap-4 rounded-xl border bg-card p-4 sm:p-5"

function GithubForm({ repoId }: { repoId: string }) {
  const router = useRouter()
  const id = useId()
  const [token, setToken] = useState("")
  const [repos, setRepos] = useState<{ fullName: string; private: boolean; defaultBranch: string }[] | null>(null)
  const [chosen, setChosen] = useState("")
  const [q, setQ] = useState("")
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()
  const shown = useMemo(() => (repos ?? []).filter((r) => r.fullName.toLowerCase().includes(q.trim().toLowerCase())), [repos, q])
  const find = () =>
    start(async () => {
      setError(undefined)
      const r = await githubRepos(token)
      if ("error" in r && r.error) return setError(r.error)
      if ("repos" in r) {
        setRepos(r.repos)
        if (!r.repos.length) setError("That token can't see any repositories. Give it access to the one you want to build.")
      }
    })
  return (
    <section className={FORM} aria-label="Connect GitHub">
      <div className="grid gap-1.5">
        <h3 className="text-sm font-semibold">Connect a GitHub repository</h3>
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">
          Make a fine-grained personal access token on GitHub, limited to the repository you want to build, with these permissions:
        </p>
        <ul className="list-disc pl-5 text-sm text-muted-foreground">
          <li>Contents: read</li>
          <li>Webhooks: read and write</li>
          <li>Commit statuses: read and write</li>
        </ul>
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
            onChange={(e) => (setToken(e.target.value), setRepos(null), setChosen(""))}
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
              const r = await connectGithub(repoId, { token, repo: chosen })
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

function GitForm({ repoId }: { repoId: string }) {
  const router = useRouter()
  const id = useId()
  const [url, setUrl] = useState("")
  const [auth, setAuth] = useState<"token" | "ssh">("token")
  const [username, setUsername] = useState("")
  const [token, setToken] = useState("")
  const [sshKey, setSshKey] = useState("")
  const [error, setError] = useState<string>()
  const [done, setDone] = useState<{ webhookUrl: string; webhookSecret: string } | null>(null)
  const [pending, start] = useTransition()
  if (done) return <Webhook {...done} onDone={() => router.refresh()} />
  return (
    <form
      className={FORM}
      aria-label="Connect a git URL"
      onSubmit={(e) => {
        e.preventDefault()
        start(async () => {
          setError(undefined)
          const r = await connectGit(repoId, auth === "token" ? { url, username, token } : { url, sshKey })
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
          <Label htmlFor={`${id}-s`}>Private key</Label>
          <textarea
            id={`${id}-s`}
            value={sshKey}
            onChange={(e) => setSshKey(e.target.value)}
            rows={5}
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
            spellCheck={false}
            autoComplete="off"
            className="min-w-0 rounded-md border border-input bg-input/20 px-3 py-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          <p className="text-xs text-muted-foreground">Use a deploy key that can read this one repository.</p>
        </div>
      )}
      <FormError>{error}</FormError>
      <SubmitButton pending={pending} disabled={!url.trim()} className={cn("w-fit", TOUCH)}>
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
        <h3 className="text-sm font-semibold">Build from the command line</h3>
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">
          From a folder with a Dockerfile, with the Nimbus CLI signed in. You can also drop a .zip or .tar here on the Builds tab.
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

export function SourceRow({ repoId, source, canAdmin }: { repoId: string; source: SourceView; canAdmin: boolean }) {
  const router = useRouter()
  const setNotice = useNotice()
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()
  const Icon = source.kind === "github" ? GithubLogoIcon : source.kind === "git" ? GitBranchIcon : TerminalWindowIcon
  const title = source.kind === "github" ? source.url : source.kind === "git" ? source.url : "Uploads and the command line"
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
        </div>
        {source.kind === "git" && source.webhookUrl && <CopyButton value={source.webhookUrl} label="Copy webhook URL" className={TOUCH} />}
        {canAdmin && (
          <RowMenu label="Source options">
            <Menu.Item className={cn(MENU_ITEM, "text-destructive [&_svg]:text-destructive")} onClick={() => setAsking(true)}>
              <PlugsIcon />
              Disconnect
            </Menu.Item>
          </RowMenu>
        )}
      </div>
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
