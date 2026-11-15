"use client"

import { Dialog } from "@base-ui/react/dialog"
import { Menu } from "@base-ui/react/menu"
import { ArrowSquareOutIcon, CheckCircleIcon, GitBranchIcon, GithubLogoIcon, GitlabLogoSimpleIcon, KeyIcon, PencilSimpleIcon, PlugsConnectedIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react"
import Link from "next/link"
import { useId, useState, useTransition } from "react"

import { addConnection, deleteConnection, renameConnection, replaceConnectionSecret } from "@/app/(app)/registry/actions"
import { DIALOG_BACKDROP, DIALOG_POPUP, MENU_ITEM } from "@/components/overlay-styles"
import { DAY, Empty, FadeX, Heading, LIST, RowMenu, SECTION, SELECT, Segmented, TOUCH, WHEN } from "@/components/registry-ui"
import { SubmitButton } from "@/components/submit-button"
import { useNotice } from "@/components/toaster"
import { FormError } from "@/components/two-factor"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { expiryOf, PROVIDER_LABEL, type Provider } from "@/lib/registry/connection-rules"
import type { ConnectionView } from "@/lib/registry/connections"
import { cn } from "@/lib/utils"

export type OwnerOption = { id: string; name: string; label: string }

const PROVIDER_OPTIONS = [
  ["github", "GitHub"],
  ["gitlab", "GitLab"],
  ["gitea", "Gitea"],
  ["git", "Other git"],
  ["ssh", "SSH key"],
] as const

export function ProviderIcon({ provider, className }: { provider: Provider; className?: string }) {
  const Icon = provider === "github" ? GithubLogoIcon : provider === "gitlab" ? GitlabLogoSimpleIcon : provider === "ssh" ? KeyIcon : GitBranchIcon
  return <Icon aria-hidden className={className} />
}

// "Expires in 6 days", "Expired", or nothing when it never expires or is far off.
export function ExpiryBadge({ at, always }: { at: string | null; always?: boolean }) {
  const e = expiryOf(at ? new Date(at) : null)
  if (e.state === "none" || (e.state === "ok" && !always)) return null
  const text = e.state === "expired" ? "Expired" : `Expires in ${e.days} day${e.days === 1 ? "" : "s"}`
  return (
    <Badge variant={e.state === "ok" ? "outline" : "secondary"} className={cn(e.state === "expired" && "text-destructive")} suppressHydrationWarning>
      {text}
    </Badge>
  )
}

const TEXTAREA =
  "min-w-0 rounded-md border border-input bg-input/20 px-3 py-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"

// ---- the Access section ---------------------------------------------------------------------------------------

export function ConnectionsSection({ connections, owners }: { connections: ConnectionView[]; owners: OwnerOption[] }) {
  const [adding, setAdding] = useState(false)
  const groups = [...new Set(connections.map((c) => c.namespaceId))].map((id) => {
    const rows = connections.filter((c) => c.namespaceId === id)
    return { id, owner: rows[0].owner, kind: rows[0].ownerKind, rows }
  })
  // You first, then orgs by name.
  groups.sort((a, b) => Number(b.kind === "user") - Number(a.kind === "user") || a.owner.localeCompare(b.owner))
  return (
    <section className={SECTION} aria-labelledby="connections-heading">
      <Heading
        id="connections-heading"
        title="Connections"
        hint="Saved GitHub, GitLab, Gitea and git credentials for image builds. Connect a repository once, pick the connection for the next one."
      >
        <Button className={TOUCH} onClick={() => setAdding(true)} disabled={!owners.length}>
          <PlusIcon />
          Add connection
        </Button>
      </Heading>
      {connections.length === 0 ? (
        <Empty icon={PlugsConnectedIcon} title="No connections yet">
          Add a GitHub token or git credential here, or tick “Save as a connection” when you connect a repository for builds.
        </Empty>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((g) => (
            <div key={g.id} className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">
                {g.kind === "user" ? "Yours" : g.owner}
                {g.kind === "org" && <span className="font-normal text-muted-foreground"> · org{g.rows[0].canManage ? "" : ", you can pick these but not change them"}</span>}
              </h3>
              <ul className={LIST}>
                {g.rows.map((c) => (
                  <ConnectionItem key={c.id} c={c} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      <AddConnection open={adding} owners={owners} onClose={() => setAdding(false)} />
    </section>
  )
}

function ConnectionItem({ c }: { c: ConnectionView }) {
  const [mode, setMode] = useState<"rename" | "replace" | "delete" | null>(null)
  const place = c.host ?? (c.provider === "github" ? "github.com" : null)
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <ProviderIcon provider={c.provider} className="size-5 shrink-0 text-muted-foreground" />
        <div className="grid min-w-0 flex-1 basis-56 gap-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <span className="min-w-0 break-words">{c.name}</span>
            <Badge variant="outline">{PROVIDER_LABEL[c.provider]}</Badge>
            <ExpiryBadge at={c.expiresAt} />
          </p>
          <p suppressHydrationWarning className="text-xs text-pretty break-words text-muted-foreground">
            {[c.account && `@${c.account}`, c.username && !c.account ? c.username : null, place].filter(Boolean).join(" · ") || "No account recorded"}
            {" · "}
            {c.lastUsedAt ? `Last used ${WHEN.format(new Date(c.lastUsedAt))}` : "Not used yet"}
            {c.expiresAt ? ` · ${new Date(c.expiresAt).getTime() < Date.now() ? "Expired" : "Expires"} ${DAY.format(new Date(c.expiresAt))}` : ""}
          </p>
        </div>
        {c.canManage && (
          <RowMenu label={`Options for ${c.name}`}>
            <Menu.Item className={MENU_ITEM} onClick={() => setMode("rename")}>
              <PencilSimpleIcon />
              Rename
            </Menu.Item>
            <Menu.Item className={MENU_ITEM} onClick={() => setMode("replace")}>
              <KeyIcon />
              Replace {c.provider === "ssh" ? "key" : "token"}
            </Menu.Item>
            <Menu.Item className={cn(MENU_ITEM, "text-destructive [&_svg]:text-destructive")} onClick={() => setMode("delete")}>
              <TrashIcon />
              Delete
            </Menu.Item>
          </RowMenu>
        )}
      </div>
      {c.canManage ? (
        c.usedBy === 0 ? (
          <p className="text-xs text-muted-foreground">Not used by any repository yet.</p>
        ) : (
          <details className="group text-xs">
            <summary className="w-fit cursor-pointer rounded-sm py-1 text-muted-foreground outline-none select-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:py-3">
              Used by {c.usedBy} {c.usedBy === 1 ? "repository" : "repositories"}
            </summary>
            <ul className="mt-1 flex flex-col gap-0.5">
              {c.repos.map((r) => (
                <li key={r.id}>
                  <Link href={`/registry/${r.fullName}?tab=builds`} className="inline-flex min-h-6 items-center gap-1 rounded-sm font-mono break-all underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:min-h-11">
                    {r.fullName}
                    <ArrowSquareOutIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        )
      ) : (
        <p className="text-xs text-muted-foreground">Shared with admins of this org&apos;s repositories. The secret is never shown.</p>
      )}
      {c.canManage && (
        <>
          <RenameDialog c={c} open={mode === "rename"} onClose={() => setMode(null)} />
          <ReplaceDialog c={c} open={mode === "replace"} onClose={() => setMode(null)} />
          <DeleteDialog c={c} open={mode === "delete"} onClose={() => setMode(null)} />
        </>
      )}
    </li>
  )
}

function Popup({ open, title, text, onClose, busy, children }: { open: boolean; title: string; text: React.ReactNode; onClose: () => void; busy: boolean; children: React.ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={cn(DIALOG_POPUP, "max-h-[calc(100svh-2rem)] overflow-y-auto")}>
          <div className="grid gap-1.5">
            <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
            <Dialog.Description className="text-sm text-pretty text-muted-foreground">{text}</Dialog.Description>
          </div>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function RenameDialog({ c, open, onClose }: { c: ConnectionView; open: boolean; onClose: () => void }) {
  const id = useId()
  const setNotice = useNotice()
  const [name, setName] = useState(c.name)
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()
  return (
    <Popup open={open} onClose={onClose} busy={pending} title="Rename connection" text="Repositories that use it keep working.">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          setError(undefined)
          start(async () => {
            const r = await renameConnection(c.id, name)
            if (r.error) return setError(r.error)
            setNotice({ text: "Renamed." })
            onClose()
          })
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor={`${id}-n`}>Name</Label>
          <Input id={`${id}-n`} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="off" autoFocus className="pointer-coarse:h-11" />
        </div>
        <FormError>{error}</FormError>
        <div className="flex justify-end gap-2">
          <Dialog.Close disabled={pending} render={<Button variant="outline" className={TOUCH} />}>
            Cancel
          </Dialog.Close>
          <SubmitButton pending={pending} disabled={!name.trim() || name.trim() === c.name} className={TOUCH}>
            Rename
          </SubmitButton>
        </div>
      </form>
    </Popup>
  )
}

function ReplaceDialog({ c, open, onClose }: { c: ConnectionView; open: boolean; onClose: () => void }) {
  const id = useId()
  const setNotice = useNotice()
  const [secret, setSecret] = useState("")
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()
  const what = c.provider === "ssh" ? "key" : "token"
  const used = c.usedBy === 1 ? "1 repository uses" : `${c.usedBy} repositories use`
  return (
    <Popup
      open={open}
      onClose={onClose}
      busy={pending}
      title={`Replace the ${what}`}
      text={`${c.usedBy ? `${used} this connection and pick up the new ${what} straight away.` : `The old ${what} stops working.`} Nimbus checks it before saving.`}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          setError(undefined)
          start(async () => {
            const r = await replaceConnectionSecret(c.id, secret)
            if (r.error) return setError(r.error)
            setNotice({ text: `Replaced the ${what} of “${c.name}”.` })
            setSecret("")
            onClose()
          })
        }}
      >
        <SecretField id={`${id}-s`} provider={c.provider} value={secret} onChange={setSecret} label={`New ${what}`} />
        <FormError>{error}</FormError>
        <div className="flex justify-end gap-2">
          <Dialog.Close disabled={pending} render={<Button variant="outline" className={TOUCH} />}>
            Cancel
          </Dialog.Close>
          <SubmitButton pending={pending} disabled={!secret.trim()} className={TOUCH}>
            Replace
          </SubmitButton>
        </div>
      </form>
    </Popup>
  )
}

function DeleteDialog({ c, open, onClose }: { c: ConnectionView; open: boolean; onClose: () => void }) {
  const setNotice = useNotice()
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()
  return (
    <Popup
      open={open}
      onClose={onClose}
      busy={pending}
      title={`Delete “${c.name}”?`}
      text={c.usedBy ? "These repositories lose their credential. Their rules stay, and builds fail until someone picks another connection in Builds." : "Nothing uses it. The token or key is removed from Nimbus."}
    >
      {c.usedBy > 0 && (
        <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-lg border p-2 text-sm">
          {c.repos.map((r) => (
            <li key={r.id} className="font-mono break-all">
              {r.fullName}
            </li>
          ))}
        </ul>
      )}
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
              const r = await deleteConnection(c.id)
              if (r.error) return setError(r.error)
              setNotice({ text: `Deleted “${c.name}”.` })
              onClose()
            })
          }
        >
          Delete
        </Button>
      </div>
    </Popup>
  )
}

// A password field, or a box for a pasted private key.
export function SecretField({ id, provider, value, onChange, label }: { id: string; provider: Provider; value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {provider === "ssh" ? (
        <textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={5}
          placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
          spellCheck={false}
          autoComplete="off"
          className={TEXTAREA}
        />
      ) : (
        <Input
          id={id}
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={provider === "github" ? "github_pat_…" : undefined}
          className="font-mono pointer-coarse:h-11"
          autoComplete="off"
          spellCheck={false}
        />
      )}
    </div>
  )
}

export function GithubTokenHelp() {
  return (
    <div className="grid gap-1.5 rounded-lg border bg-input/10 p-3 text-sm">
      <p className="text-pretty text-muted-foreground">Use a fine-grained personal access token with these repository permissions:</p>
      <ul className="list-disc pl-5 text-muted-foreground">
        <li>Contents: read</li>
        <li>Webhooks: read and write</li>
        <li>Commit statuses: read and write</li>
      </ul>
      <a
        href="https://github.com/settings/personal-access-tokens/new"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex w-fit items-center gap-1 rounded-sm text-foreground underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:min-h-11 pointer-coarse:items-center"
      >
        Make a token on GitHub
        <ArrowSquareOutIcon aria-hidden className="size-3.5" />
      </a>
    </div>
  )
}

// ---- adding ------------------------------------------------------------------------------------------------------

function AddConnection({ open, owners, onClose }: { open: boolean; owners: OwnerOption[]; onClose: () => void }) {
  const id = useId()
  const [provider, setProvider] = useState<Provider>("github")
  const [owner, setOwner] = useState(owners[0]?.id ?? "")
  const [name, setName] = useState("")
  const [host, setHost] = useState("")
  const [username, setUsername] = useState("")
  const [secret, setSecret] = useState("")
  const [error, setError] = useState<string>()
  const [made, setMade] = useState<{ name: string; account: string | null; expiresAt: string | null }>()
  const [pending, start] = useTransition()
  const needsHost = provider === "gitlab" || provider === "gitea" || provider === "git"
  const close = () => {
    onClose()
    setTimeout(() => {
      setMade(undefined)
      setError(undefined)
      setSecret("")
      setName("")
      setHost("")
      setUsername("")
      setProvider("github")
    }, 200)
  }
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && !pending && close()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={cn(DIALOG_POPUP, "max-h-[calc(100svh-2rem)] max-w-lg overflow-y-auto")}>
          <div className="grid gap-1.5">
            <Dialog.Title className="text-base font-semibold">{made ? "Connection saved" : "Add connection"}</Dialog.Title>
            <Dialog.Description className="text-sm text-pretty text-muted-foreground">
              {made ? "Pick it when you connect a repository for builds." : "Nimbus stores the secret encrypted and shows it to no one, you included."}
            </Dialog.Description>
          </div>
          {made ? (
            <>
              <div className="grid gap-1 rounded-lg border p-3 text-sm">
                <p className="flex items-center gap-2 font-medium">
                  <CheckCircleIcon aria-hidden weight="fill" className="size-4 shrink-0 text-brand" />
                  <span className="min-w-0 break-words">{made.name}</span>
                </p>
                {made.account && <p className="text-muted-foreground">Signed in as @{made.account}</p>}
                <p suppressHydrationWarning className="text-muted-foreground">
                  {made.expiresAt ? `Expires ${DAY.format(new Date(made.expiresAt))}. Nimbus warns you a week before.` : "No expiry date on this one."}
                </p>
              </div>
              <div className="flex justify-end">
                <Button className={TOUCH} onClick={close}>
                  Done
                </Button>
              </div>
            </>
          ) : (
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                setError(undefined)
                start(async () => {
                  const r = await addConnection({ namespaceId: owner, provider, name, host, username, secret })
                  if (r.error || !r.id) return setError(r.error ?? "Couldn't save the connection.")
                  setMade({ name: name.trim() || r.account || PROVIDER_LABEL[provider], account: r.account ?? null, expiresAt: r.expiresAt ?? null })
                })
              }}
            >
              <div className="grid gap-2">
                <span className="text-sm font-medium">For</span>
                <FadeX>
                  <Segmented label="Provider" value={provider} options={PROVIDER_OPTIONS} onChange={(p) => (setProvider(p), setSecret(""), setError(undefined))} />
                </FadeX>
              </div>
              {provider === "github" && <GithubTokenHelp />}
              {owners.length > 1 && (
                <div className="grid gap-2">
                  <Label htmlFor={`${id}-o`}>Owner</Label>
                  <select id={`${id}-o`} value={owner} onChange={(e) => setOwner(e.target.value)} className={cn(SELECT, "pointer-coarse:h-11")}>
                    {owners.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label === "You" ? "You" : `${o.label} (org)`}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-pretty text-muted-foreground">An org connection can be picked by any admin of the org&apos;s repositories, who never see the secret.</p>
                </div>
              )}
              {needsHost && (
                <div className="grid gap-2">
                  <Label htmlFor={`${id}-h`}>{provider === "git" ? "Server (optional)" : "Server"}</Label>
                  <Input id={`${id}-h`} value={host} onChange={(e) => setHost(e.target.value)} placeholder="git.example.com" className="font-mono pointer-coarse:h-11" autoComplete="off" spellCheck={false} />
                </div>
              )}
              {needsHost && (
                <div className="grid gap-2">
                  <Label htmlFor={`${id}-u`}>Username (optional)</Label>
                  <Input id={`${id}-u`} value={username} onChange={(e) => setUsername(e.target.value)} className="pointer-coarse:h-11" autoComplete="off" />
                </div>
              )}
              <SecretField id={`${id}-s`} provider={provider} value={secret} onChange={setSecret} label={provider === "ssh" ? "Private key" : "Token or password"} />
              {provider === "ssh" && <p className="-mt-2 text-xs text-muted-foreground">Use a deploy key that can read the repositories you will build.</p>}
              <div className="grid gap-2">
                <Label htmlFor={`${id}-n`}>Name</Label>
                <Input id={`${id}-n`} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={provider === "github" ? "Defaults to the GitHub account" : "Work GitLab"} autoComplete="off" className="pointer-coarse:h-11" />
              </div>
              <FormError>{error}</FormError>
              <div className="flex justify-end gap-2">
                <Dialog.Close disabled={pending} render={<Button variant="outline" className={TOUCH} />}>
                  Cancel
                </Dialog.Close>
                <SubmitButton pending={pending} disabled={!secret.trim() || !owner || (!name.trim() && provider !== "github")} className={TOUCH}>
                  Save connection
                </SubmitButton>
              </div>
            </form>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
