"use client"

import { Dialog } from "@base-ui/react/dialog"
import { BuildingsIcon, CheckCircleIcon, KeyIcon, LockSimpleIcon, GlobeIcon, PackageIcon, PlusIcon, UsersIcon } from "@phosphor-icons/react"
import Link from "next/link"
import { useEffect, useId, useState, useTransition } from "react"

import {
  addOrgMember,
  claimName,
  createOrg,
  createToken,
  deleteOrg,
  orgMembers,
  removeOrgMember,
  renameOrg,
  revokeToken,
  setOrgRole,
} from "@/app/(app)/registry/actions"
import { SaveToSecrets } from "@/components/registry-save-secret"
import { CopyButton } from "@/components/copy-button"
import { DIALOG_BACKDROP, DIALOG_POPUP } from "@/components/overlay-styles"
import { MirrorsTab, NamespacesSection, RegistryTabs, TrashTab, type Tab } from "@/components/registry-extra"
import { Code, Confirm, DAY, Empty, Heading, LIST, RADIO, SECTION, SELECT, TOUCH, WHEN } from "@/components/registry-ui"
import { SubmitButton } from "@/components/submit-button"
import { useNotice } from "@/components/toaster"
import { FormError } from "@/components/two-factor"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { sizeOf } from "@/lib/registry/size"
import type { CachedRepo, OrgMember, OrgRow, OwnedNamespace, RepoRow, TokenRow, TrashRow } from "@/lib/registry/manage"
import { cn } from "@/lib/utils"

const EXPIRY = [
  ["never", "Never"],
  ["30", "In 30 days"],
  ["90", "In 90 days"],
  ["365", "In a year"],
]
const ROLE_LABEL = { owner: "Owner", write: "Can push", read: "Read only" }

// The commands a member runs once they have a token. One block, so Copy takes all of it.
const connectCommands = (host: string, me: string) =>
  [
    `docker login ${host} -u ${me}`,
    "# paste a token as the password",
    "",
    `docker pull ${host}/${me}/<repo>:<tag>`,
    `docker push ${host}/${me}/<repo>:<tag>`,
  ].join("\n")

const githubAction = (host: string, me: string) =>
  [
    "- uses: docker/login-action@v3",
    "  with:",
    `    registry: ${host}`,
    `    username: ${me}`,
    "    password: ${{ secrets.NIMBUS_REGISTRY_TOKEN }}",
  ].join("\n")

function CodeCopy({ text, label }: { text: string; label: string }) {
  return (
    <div className="relative">
      <Code copy>{text}</Code>
      <div className="absolute top-2 right-2">
        <CopyButton value={text} label={label} className={TOUCH} />
      </div>
    </div>
  )
}

// First-run card: shown until the member has a token and a repository.
function SetupCard({ host, me, tokens, onNewToken }: { host: string; me: string; tokens: number; onNewToken: () => void }) {
  return (
    <section aria-labelledby="setup-heading" className="flex flex-col gap-4 rounded-xl border bg-card p-4 sm:p-5">
      <Heading
        id="setup-heading"
        title="Connect Docker"
        hint="Two steps and your first image is here. This card goes away once you have a token and a repository."
      />
      <ol className="flex flex-col gap-4">
        <li className="grid grid-cols-[minmax(0,1fr)] gap-2">
          <p className="text-sm font-medium">1. Make a token</p>
          <p className="text-sm text-pretty text-muted-foreground">Docker uses it as the password, never your account password.</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant={tokens ? "outline" : "default"} className={TOUCH} onClick={onNewToken}>
              <PlusIcon />
              New token
            </Button>
            {tokens > 0 && (
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <CheckCircleIcon className="size-4 text-brand" />
                {tokens === 1 ? "You have a token" : `You have ${tokens} tokens`}
              </span>
            )}
          </div>
        </li>
        <li className="grid grid-cols-[minmax(0,1fr)] gap-2">
          <p className="text-sm font-medium">2. Log in and push</p>
          <CodeCopy
            label="Copy login and push commands"
            text={`docker login ${host} -u ${me}\ndocker tag myimage ${host}/${me}/myimage:latest\ndocker push ${host}/${me}/myimage:latest`}
          />
        </li>
      </ol>
    </section>
  )
}

// Shown until a member picks their registry name; the name is the first part of every image they push.
export function ClaimName({ suggestion }: { suggestion: string }) {
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()
  const [name, setName] = useState(suggestion)
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Container registry</h1>
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">
          Push Docker and OCI images to Nimbus and pull them anywhere.
        </p>
      </header>
      <form
        className="flex flex-col gap-4 rounded-xl border bg-card p-5"
        onSubmit={(e) => {
          e.preventDefault()
          setError(undefined)
          start(async () => {
            const r = await claimName(name)
            if (r.error) setError(r.error)
          })
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="claim-name">Pick your registry name</Label>
          <p className="text-sm text-pretty text-muted-foreground">
            Your images live under it, like <span className="font-mono">{name || "name"}/web:latest</span>. 2 to 39
            lowercase letters, numbers and hyphens. It can&apos;t be changed later.
          </p>
        </div>
        <Input
          id="claim-name"
          value={name}
          onChange={(e) => setName(e.target.value.toLowerCase())}
          maxLength={39}
          autoComplete="off"
          autoFocus
          className="font-mono"
        />
        <FormError>{error}</FormError>
        <SubmitButton pending={pending} className="self-start">
          Claim name
        </SubmitButton>
      </form>
    </div>
  )
}

export function RegistryView({
  me,
  meId,
  host,
  repos,
  orgs,
  tokens,
  maxTokens,
  canCreateOrg,
  publicAllowed,
  tab,
  trash,
  trashDays,
  owned,
  upstreams,
  cached,
}: {
  me: string
  meId: string
  host: string
  repos: RepoRow[]
  orgs: OrgRow[]
  tokens: TokenRow[]
  maxTokens: number
  canCreateOrg: boolean
  publicAllowed: boolean
  tab: Tab
  trash: TrashRow[]
  trashDays: number
  owned: OwnedNamespace[]
  upstreams: { name: string; url: string; ttlDays: number }[]
  cached: CachedRepo[]
}) {
  const [newOrg, setNewOrg] = useState(false)
  const [newToken, setNewToken] = useState(false)
  const [managing, setManaging] = useState<OrgRow | null>(null)
  const setNotice = useNotice()
  const firstRun = tokens.length === 0 || repos.length === 0
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-10">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Container registry</h1>
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">
          Push Docker and OCI images to <span className="font-mono">{host}</span> and pull them from anywhere. Your
          registry name is <span className="font-mono text-foreground">{me}</span>.
        </p>
      </header>

      <RegistryTabs tab={tab} trash={trash.length} />

      {tab === "repos" && firstRun && <SetupCard host={host} me={me} tokens={tokens.length} onNewToken={() => setNewToken(true)} />}

      {tab === "repos" && (
        <>
          <section className={SECTION} aria-labelledby="repos-heading">
            <Heading
              id="repos-heading"
              title="Repositories"
              hint={
                publicAllowed
                  ? "Made on your first push. Open one for tags, layers and settings."
                  : "Made on your first push. Open one for tags, layers and settings. Public repositories are off on this server."
              }
            />
            {repos.length === 0 ? (
              <Empty icon={PackageIcon} title="No repositories yet">
                Your first push makes one, under <span className="font-mono">{me}/</span>.
              </Empty>
            ) : (
              <ul className={LIST}>
                {repos.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/registry/${r.fullName}`}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 outline-none hover:bg-accent/40 focus-visible:bg-accent/40"
                    >
                      <span className="grid min-w-0 flex-1 basis-56 gap-0.5">
                        <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                          <span className="font-mono break-all">{r.fullName}</span>
                          <Badge variant="outline" className="gap-1">
                            {r.isPublic ? <GlobeIcon /> : <LockSimpleIcon />}
                            {r.isPublic ? "Public" : "Private"}
                          </Badge>
                        </span>
                        <span suppressHydrationWarning className="text-xs text-muted-foreground">
                          {r.tags === 1 ? "1 tag" : `${r.tags} tags`} · <span className="tabular-nums">{sizeOf(r.bytes)}</span>
                          {r.pushedAt ? ` · Pushed ${WHEN.format(new Date(r.pushedAt))}` : ""}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {tab === "access" && (
        <>
          <section className={SECTION} aria-labelledby="tokens-heading">
            <Heading
              id="tokens-heading"
              title="Tokens"
              hint={`Docker signs in with a token as the password, never your account password. Make one per machine so you can revoke it alone. ${tokens.length} of ${maxTokens} used.`}
            >
              <Button className={TOUCH} onClick={() => setNewToken(true)} disabled={tokens.length >= maxTokens}>
                <PlusIcon />
                New token
              </Button>
            </Heading>
            {tokens.length === 0 ? (
              <Empty icon={KeyIcon} title="No tokens yet">
                Make a token to docker login. You see it once, right after it&apos;s made.
              </Empty>
            ) : (
              <ul className={LIST}>
                {tokens.map((t) => (
                  <TokenItem key={t.id} t={t} />
                ))}
              </ul>
            )}
          </section>

          <section className={SECTION} aria-labelledby="connect-heading">
            <Heading
              id="connect-heading"
              title="Connect Docker"
              hint="Log in with your registry name and a token, then push and pull as usual."
            />
            <CodeCopy text={connectCommands(host, me)} label="Copy Docker commands" />
            <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
              <p className="text-sm font-medium">GitHub Actions</p>
              <p className="max-w-prose text-sm text-pretty text-muted-foreground">
                Save a pull &amp; push token as the repository secret <span className="font-mono">NIMBUS_REGISTRY_TOKEN</span>.
              </p>
              <CodeCopy text={githubAction(host, me)} label="Copy GitHub Actions step" />
            </div>
          </section>

          <section className={SECTION} aria-labelledby="orgs-heading">
            <Heading
              id="orgs-heading"
              title="Orgs"
              hint="A shared registry name for a team. Members push and pull under it by role."
            >
              {canCreateOrg && (
                <Button className={TOUCH} onClick={() => setNewOrg(true)}>
                  <PlusIcon />
                  New org
                </Button>
              )}
            </Heading>
            {orgs.length === 0 ? (
              <Empty icon={BuildingsIcon} title="No orgs yet">
                {canCreateOrg
                  ? "Make an org to share images with others, or ask to be added to one."
                  : "Only admins make orgs on this server. Ask one to add you to an org."}
              </Empty>
            ) : (
              <ul className={LIST}>
                {orgs.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                    <div className="grid min-w-0 flex-1 basis-56 gap-0.5">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        <span className="font-mono break-all">{o.name}</span>
                        <Badge variant="outline">{ROLE_LABEL[o.role]}</Badge>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {o.displayName !== o.name && `${o.displayName} · `}
                        {o.members === 1 ? "1 member" : `${o.members} members`} ·{" "}
                        {o.repos === 1 ? "1 repository" : `${o.repos} repositories`}
                      </p>
                    </div>
                    <Button variant="outline" size="sm" className={TOUCH} onClick={() => setManaging(o)}>
                      <UsersIcon />
                      {o.role === "owner" ? "Manage" : "Members"}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <NamespacesSection owned={owned} />
        </>
      )}

      {tab === "trash" && <TrashTab rows={trash} days={trashDays} />}
      {tab === "mirrors" && <MirrorsTab host={host} upstreams={upstreams} cached={cached} />}

      <NewOrg
        open={newOrg}
        onClose={() => setNewOrg(false)}
        onDone={(name) => {
          setNewOrg(false)
          setNotice({ text: `Org “${name}” created.` })
        }}
      />
      <NewToken open={newToken} repos={repos} onClose={() => setNewToken(false)} host={host} me={me} />
      <ManageOrg org={managing} meId={meId} onClose={() => setManaging(null)} />
    </div>
  )
}

function TokenItem({ t }: { t: TokenRow }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string>()
  const setNotice = useNotice()
  return (
    <li className="flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="grid min-w-0 flex-1 basis-64 gap-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <span className="min-w-0 break-words">{t.name}</span>
            <Badge variant="outline">{t.access === "push" ? "Pull & push" : "Pull only"}</Badge>
            {t.expired && <Badge variant="secondary">Expired</Badge>}
          </p>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <code className="rounded bg-input/20 px-1.5 py-0.5 font-mono text-foreground select-all">{t.prefix}…</code>
            <span className="min-w-0 break-words">
              {t.allRepos ? "All repositories" : t.repos.length ? t.repos.join(", ") : "No repositories left"}
            </span>
          </p>
          <p suppressHydrationWarning className="text-xs text-pretty break-words text-muted-foreground">
            {t.expiresAt ? `${t.expired ? "Expired" : "Expires"} ${DAY.format(new Date(t.expiresAt))}` : "Never expires"}{" "}
            · Created {DAY.format(new Date(t.createdAt))} ·{" "}
            {t.lastUsedAt
              ? `Last used ${WHEN.format(new Date(t.lastUsedAt))}${t.lastIp ? ` from ${t.lastIp}` : ""}`
              : "Never used"}
          </p>
        </div>
        <Confirm
          label="Revoke"
          question="Anything using it stops at once."
          yes="Revoke"
          pending={pending}
          onYes={() =>
            start(async () => {
              const r = await revokeToken(t.id)
              if (r.error) return setError(r.error)
              setNotice({ text: `Revoked “${t.name}”.` })
            })
          }
        />
      </div>
      <FormError>{error}</FormError>
    </li>
  )
}

function NewOrg({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (name: string) => void }) {
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()
  const id = useId()
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && !pending && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={DIALOG_POPUP}>
          <div className="grid gap-1.5">
            <Dialog.Title className="text-base font-semibold">New org</Dialog.Title>
            <Dialog.Description className="text-sm text-pretty text-muted-foreground">
              The name is the first part of its images and can&apos;t be changed later. You become its owner.
            </Dialog.Description>
          </div>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              const f = new FormData(e.currentTarget)
              setError(undefined)
              start(async () => {
                const name = String(f.get("name") ?? "")
                const r = await createOrg(name, String(f.get("display") ?? ""))
                if (r.error) return setError(r.error)
                onDone(name)
              })
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor={`${id}-name`}>Name</Label>
              <Input id={`${id}-name`} name="name" maxLength={39} autoComplete="off" autoFocus placeholder="acme" className="font-mono" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-display`}>Display name (optional)</Label>
              <Input id={`${id}-display`} name="display" maxLength={80} autoComplete="off" placeholder="Acme Inc." />
            </div>
            <FormError>{error}</FormError>
            <div className="flex justify-end gap-2">
              <Dialog.Close disabled={pending} render={<Button variant="outline" />}>
                Cancel
              </Dialog.Close>
              <SubmitButton pending={pending}>Create org</SubmitButton>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ManageOrg({ org, meId, onClose }: { org: OrgRow | null; meId: string; onClose: () => void }) {
  const [members, setMembers] = useState<OrgMember[]>([])
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()
  const [display, setDisplay] = useState("")
  const setNotice = useNotice()
  const id = useId()
  const owner = org?.role === "owner"
  const orgId = org?.id

  useEffect(() => {
    if (!orgId) return
    let live = true
    setError(undefined)
    setDisplay(org?.displayName ?? "")
    orgMembers(orgId).then((m) => live && setMembers(m))
    return () => {
      live = false
    }
    // Reload only when another org opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  const run = (fn: () => Promise<{ error?: string }>, ok?: string) =>
    start(async () => {
      setError(undefined)
      const r = await fn()
      if (r.error) return setError(r.error)
      if (orgId) setMembers(await orgMembers(orgId))
      if (ok) setNotice({ text: ok })
    })

  return (
    <Dialog.Root open={Boolean(org)} onOpenChange={(o) => !o && !pending && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={cn(DIALOG_POPUP, "max-h-[calc(100svh-2rem)] max-w-lg overflow-y-auto")}>
          {org && (
            <>
              <div className="grid gap-1.5">
                <Dialog.Title className="font-mono text-base font-semibold break-all">{org.name}</Dialog.Title>
                <Dialog.Description className="text-sm text-pretty text-muted-foreground">
                  {owner
                    ? "Owners manage members and delete the org. Pushers push and pull. Readers only pull."
                    : "You can see who is in this org. Owners change it."}
                </Dialog.Description>
              </div>

              {owner && (
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    run(() => renameOrg(org.id, display), "Display name saved.")
                  }}
                >
                  <Input aria-label="Display name" value={display} onChange={(e) => setDisplay(e.target.value)} maxLength={80} />
                  <Button type="submit" variant="outline" disabled={pending || !display.trim()}>
                    Save
                  </Button>
                </form>
              )}

              <ul className="divide-y overflow-hidden rounded-lg border">
                {members.map((m) => (
                  <li key={m.userId} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
                    <span className="grid min-w-0 flex-1 basis-40">
                      <span className="truncate text-sm">{m.name}</span>
                      <span className="truncate text-xs text-muted-foreground">{m.email}</span>
                    </span>
                    {owner ? (
                      <select
                        aria-label={`Role of ${m.name}`}
                        value={m.role}
                        disabled={pending}
                        onChange={(e) => run(() => setOrgRole(org.id, m.userId, e.target.value))}
                        className={cn(SELECT, "h-8")}
                      >
                        {Object.entries(ROLE_LABEL).map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Badge variant="outline">{ROLE_LABEL[m.role]}</Badge>
                    )}
                    {owner && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className={TOUCH}
                        disabled={pending}
                        onClick={() => run(() => removeOrgMember(org.id, m.userId), `${m.name} removed.`)}
                      >
                        Remove
                      </Button>
                    )}
                  </li>
                ))}
              </ul>

              {owner && (
                <form
                  className="flex flex-wrap gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    const form = e.currentTarget
                    const f = new FormData(form)
                    run(async () => {
                      const r = await addOrgMember(org.id, String(f.get("email") ?? ""), String(f.get("role") ?? "write"))
                      if (!r.error) form.reset()
                      return r
                    }, "Member added.")
                  }}
                >
                  <Label htmlFor={`${id}-email`} className="sr-only">
                    Email of an existing member
                  </Label>
                  <Input id={`${id}-email`} name="email" type="email" required placeholder="Add by email" className="min-w-0 flex-1 basis-48" />
                  <select name="role" aria-label="Role" defaultValue="write" className={SELECT}>
                    {Object.entries(ROLE_LABEL).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                  <Button type="submit" disabled={pending}>
                    Add
                  </Button>
                </form>
              )}
              <FormError>{error}</FormError>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap gap-2">
                  {owner ? (
                    <Confirm
                      label="Delete org"
                      question="Only empty orgs can go."
                      yes="Delete"
                      pending={pending}
                      onYes={() =>
                        start(async () => {
                          const r = await deleteOrg(org.id)
                          if (r.error) return setError(r.error)
                          setNotice({ text: `Org “${org.name}” deleted.` })
                          onClose()
                        })
                      }
                    />
                  ) : (
                    <Confirm
                      label="Leave org"
                      question="You lose access to its repositories."
                      yes="Leave"
                      pending={pending}
                      onYes={() =>
                        start(async () => {
                          const r = await removeOrgMember(org.id, meId)
                          if (r.error) return setError(r.error)
                          setNotice({ text: `You left “${org.name}”.` })
                          onClose()
                        })
                      }
                    />
                  )}
                </span>
                <Dialog.Close render={<Button variant="outline" />}>Done</Dialog.Close>
              </div>
            </>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function NewToken({
  open,
  repos,
  onClose,
  host,
  me,
}: {
  open: boolean
  repos: RepoRow[]
  onClose: () => void
  host: string
  me: string
}) {
  const [made, setMade] = useState<string>()
  const [error, setError] = useState<string | null>(null)
  const [all, setAll] = useState(true)
  const [chosen, setChosen] = useState<string[]>([])
  const [expiry, setExpiry] = useState("90")
  const [pending, start] = useTransition()
  const id = useId()

  const close = () => {
    onClose()
    setTimeout(() => {
      setMade(undefined)
      setError(null)
      setAll(true)
      setChosen([])
      setExpiry("90")
    }, 200)
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && !pending && close()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={cn(DIALOG_POPUP, "max-h-[calc(100svh-2rem)] overflow-y-auto")}>
          <div className="grid gap-1.5">
            <Dialog.Title className="text-base font-semibold">{made ? "Your new token" : "New token"}</Dialog.Title>
            <Dialog.Description className="text-sm text-pretty text-muted-foreground">
              {made
                ? "Use it as the password now. It's shown only once; if you lose it, revoke it and make another."
                : "One per machine or CI job. Pick what it can reach and when it stops working."}
            </Dialog.Description>
          </div>
          {made ? (
            <>
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
                <div className="grid min-w-0 gap-1.5">
                  <span className="text-sm font-medium">Token</span>
                  <div className="flex min-w-0 items-center gap-2">
                    <code className="flex h-9 min-w-0 flex-1 items-center overflow-x-auto rounded-md border bg-input/20 px-3 font-mono text-sm select-all">
                      {made}
                    </code>
                    <CopyButton value={made} />
                  </div>
                </div>
                <div className="grid min-w-0 gap-1.5">
                  <span className="text-sm font-medium">Log in</span>
                  <code className="block overflow-x-auto rounded-md border bg-input/20 px-3 py-2 font-mono text-xs whitespace-pre select-all">
                    {`docker login ${host} -u ${me}`}
                  </code>
                </div>
              </div>
              <SaveToSecrets token={made} />
              <div className="flex justify-end">
                <Button onClick={close}>Done</Button>
              </div>
            </>
          ) : (
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                const f = new FormData(e.currentTarget)
                setError(null)
                start(async () => {
                  const r = await createToken({
                    name: String(f.get("name") ?? ""),
                    access: String(f.get("access") ?? ""),
                    allRepos: all,
                    repoIds: chosen,
                    expiry,
                  })
                  if (r.error || !r.token) return setError(r.error ?? "Couldn't make the token.")
                  setMade(r.token)
                })
              }}
            >
              <div className="grid gap-2">
                <Label htmlFor={`${id}-name`}>Name</Label>
                <Input id={`${id}-name`} name="name" maxLength={60} placeholder="CI – GitHub Actions" autoComplete="off" autoFocus />
              </div>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-sm font-medium">Access</legend>
                {(
                  [
                    ["pull", "Pull only", "Download images, nothing else."],
                    ["push", "Pull & push", "Download and upload images."],
                  ] as const
                ).map(([value, label, hint], i) => (
                  <label key={value} className={RADIO}>
                    <input type="radio" name="access" value={value} defaultChecked={i === 1} className="size-4 accent-primary" />
                    <span className="grid">
                      <span className="font-medium">{label}</span>
                      <span className="text-xs text-muted-foreground">{hint}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-sm font-medium">Repositories</legend>
                <label className={RADIO}>
                  <input type="radio" name="scope" checked={all} onChange={() => setAll(true)} className="size-4 accent-primary" />
                  <span className="grid">
                    <span className="font-medium">All repositories</span>
                    <span className="text-xs text-pretty text-muted-foreground">
                      Every repository you can reach, yours and your orgs&apos;, including ones made later. With Pull &amp; push it can also create new repositories.
                    </span>
                  </span>
                </label>
                <label className={cn(RADIO, !repos.length && "cursor-not-allowed opacity-60")}>
                  <input
                    type="radio"
                    name="scope"
                    checked={!all}
                    disabled={!repos.length}
                    onChange={() => setAll(false)}
                    className="size-4 accent-primary"
                  />
                  <span className="grid">
                    <span className="font-medium">Only some repositories</span>
                    <span className="text-xs text-muted-foreground">
                      {repos.length ? "Pick which. It can't create new repositories." : "Push an image first."}
                    </span>
                  </span>
                </label>
                {!all && (
                  <ul className="flex max-h-40 flex-col gap-0.5 overflow-y-auto rounded-lg border p-1">
                    {repos.map((r) => (
                      <li key={r.id}>
                        <label className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-accent/50 pointer-coarse:h-11">
                          <input
                            type="checkbox"
                            checked={chosen.includes(r.id)}
                            onChange={(e) => setChosen(e.target.checked ? [...chosen, r.id] : chosen.filter((c) => c !== r.id))}
                            className="size-4 accent-primary"
                          />
                          <span className="truncate font-mono">{r.fullName}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </fieldset>
              <div className="grid gap-2">
                <Label htmlFor={`${id}-expiry`}>Expires</Label>
                <select id={`${id}-expiry`} name="expiry" value={expiry} onChange={(e) => setExpiry(e.target.value)} className={SELECT}>
                  {EXPIRY.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
                {expiry === "never" && (
                  <p className="text-xs text-pretty text-muted-foreground">
                    It works until you revoke it. If it leaks, anyone can push and pull with it. Pick a date for CI jobs and shared machines.
                  </p>
                )}
              </div>
              <FormError>{error}</FormError>
              <div className="flex justify-end gap-2">
                <Dialog.Close disabled={pending} render={<Button variant="outline" />}>
                  Cancel
                </Dialog.Close>
                <SubmitButton pending={pending}>Create token</SubmitButton>
              </div>
            </form>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
