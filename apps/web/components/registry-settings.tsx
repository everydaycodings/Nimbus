"use client"

import { Dialog } from "@base-ui/react/dialog"
import { ArchiveIcon, InfoIcon } from "@phosphor-icons/react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useId, useState, useTransition } from "react"

import {
  addCollaborator,
  checkRepoName,
  removeCollaborator,
  renameRepo,
  setArchived,
  setCollaboratorRole,
  setDescription,
  setTeamRepo,
} from "@/app/(app)/registry/actions"
import { DIALOG_BACKDROP, DIALOG_POPUP } from "@/components/overlay-styles"
import { Confirm, Heading, LIST, NameStatus, SECTION, SELECT, TOUCH, useNameCheck } from "@/components/registry-ui"
import { SubmitButton } from "@/components/submit-button"
import { useNotice } from "@/components/toaster"
import { FormError } from "@/components/two-factor"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { RepoAccess, RepoDetail } from "@/lib/registry/manage"
import { cn } from "@/lib/utils"

const GRANTS = [
  ["read", "Read"],
  ["write", "Write"],
  ["admin", "Admin"],
] as const
// Matches DESCRIPTION_MAX in lib/registry/rules (that file pulls in node:crypto, so it stays out of the client).
const DESCRIPTION_MAX = 100
const SEL = cn(SELECT, "pointer-coarse:h-11")
const FIELD = "pointer-coarse:h-11"

// Shown on Overview and Tags while the repository is archived.
export function ArchivedStrip({ repo }: { repo: RepoDetail }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string>()
  const setNotice = useNotice()
  if (!repo.archived) return null
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-muted/40 px-4 py-3">
      <p className="flex min-w-0 flex-1 basis-64 items-start gap-2 text-sm text-pretty">
        <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span>Archived: read-only. Pushes and deletes are refused; cleanup rules skip it.</span>
      </p>
      {repo.canAdmin && (
        <Button
          variant="outline"
          size="sm"
          className={TOUCH}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await setArchived(repo.id, false)
              if (r.error) return setError(r.error)
              setNotice({ text: "Unarchived. Pushes and deletes work again." })
            })
          }
        >
          Unarchive
        </Button>
      )}
      <FormError>{error}</FormError>
    </div>
  )
}

// One line, up to 100 characters. Blank goes back to the image label.
export function DescriptionForm({ repo }: { repo: RepoDetail }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string>()
  const [text, setText] = useState(repo.description ?? "")
  const setNotice = useNotice()
  const id = useId()
  const save = (value: string | null, ok: string) =>
    start(async () => {
      setError(undefined)
      const r = await setDescription(repo.id, value)
      if (r.error) return setError(r.error)
      setNotice({ text: ok })
    })
  return (
    <form
      key={`${repo.description}|${repo.descriptionCustom}`}
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        save(text.trim() || null, text.trim() ? "Description saved." : "Description follows the image label again.")
      }}
    >
      <Label htmlFor={id}>Description</Label>
      <p className="text-xs text-pretty text-muted-foreground">
        One line shown under the name and in lists.{" "}
        {repo.descriptionCustom
          ? "You wrote this one, so pushes don't change it."
          : "It follows the image's description label until you write your own."}
      </p>
      <div className="flex flex-wrap gap-2">
        <Input
          id={id}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={DESCRIPTION_MAX}
          autoComplete="off"
          aria-describedby={`${id}-count`}
          className={cn("min-w-0 flex-1 basis-64", FIELD)}
        />
        <SubmitButton pending={pending} variant="outline" className={TOUCH}>
          Save
        </SubmitButton>
        {repo.descriptionCustom && (
          <Button type="button" variant="ghost" className={TOUCH} disabled={pending} onClick={() => save(null, "Description follows the image label again.")}>
            Use image label
          </Button>
        )}
      </div>
      <p id={`${id}-count`} className="text-xs text-muted-foreground tabular-nums">
        {text.length} of {DESCRIPTION_MAX}
      </p>
      <FormError>{error}</FormError>
    </form>
  )
}

// ---- Access ----------------------------------------------------------------

export function AccessSection({ repo, access }: { repo: RepoDetail; access: RepoAccess }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string>()
  const router = useRouter()
  const setNotice = useNotice()
  const id = useId()
  const run = (fn: () => Promise<{ error?: string }>, ok?: string) =>
    start(async () => {
      setError(undefined)
      const r = await fn()
      if (r.error) return setError(r.error)
      if (ok) setNotice({ text: ok })
      router.refresh()
    })
  const free = access.teams.filter((t) => !access.granted.some((g) => g.teamId === t.id))
  return (
    <section id="access" className={cn(SECTION, "scroll-mt-20")} aria-labelledby="access-heading">
      <Heading
        id="access-heading"
        title="Access"
        hint={
          repo.orgId
            ? "Org members keep their org role. Add people or teams for more access to this repository."
            : "Only you can push here. Add collaborators to let others pull or push."
        }
      />
      <dl className="grid gap-x-6 gap-y-1 rounded-xl border bg-card p-4 text-xs text-muted-foreground sm:grid-cols-[auto_minmax(0,1fr)]">
        <dt className="font-medium text-foreground">Read</dt>
        <dd>Pull images.</dd>
        <dt className="font-medium text-foreground">Write</dt>
        <dd>Pull, push, and delete tags and images.</dd>
        <dt className="font-medium text-foreground">Admin</dt>
        <dd>Write, plus access, rename, archive and the activity log. Not other repositories.</dd>
      </dl>

      <div className="grid gap-2">
        <h3 className="text-sm font-medium">Collaborators</h3>
        {access.collaborators.length > 0 && (
          <ul className={LIST}>
            {access.collaborators.map((c) => (
              <li key={c.userId} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                <span className="grid min-w-0 flex-1 basis-44">
                  <span className="truncate text-sm font-medium">{c.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{c.email}</span>
                </span>
                <select
                  aria-label={`Role of ${c.name}`}
                  value={c.role}
                  disabled={pending}
                  onChange={(e) => run(() => setCollaboratorRole(repo.id, c.userId, e.target.value), `${c.name} is now ${e.target.value}.`)}
                  className={SEL}
                >
                  {GRANTS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
                <Button
                  variant="ghost"
                  size="sm"
                  className={TOUCH}
                  aria-label={`Remove ${c.name}`}
                  disabled={pending}
                  onClick={() => run(() => removeCollaborator(repo.id, c.userId), `${c.name} removed.`)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const form = e.currentTarget
            const f = new FormData(form)
            run(async () => {
              const r = await addCollaborator(repo.id, String(f.get("email") ?? ""), String(f.get("role") ?? "read"))
              if (!r.error) form.reset()
              return r
            }, "Collaborator added.")
          }}
        >
          <Label htmlFor={`${id}-email`} className="sr-only">
            Email of an existing member
          </Label>
          <Input id={`${id}-email`} name="email" type="email" required placeholder="Add by email" className={cn("min-w-0 flex-1 basis-48", FIELD)} />
          <select name="role" aria-label="Role for the new collaborator" defaultValue="read" className={SEL}>
            {GRANTS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <SubmitButton pending={pending} variant="outline" className={TOUCH}>
            Add
          </SubmitButton>
        </form>
        {access.collaborators.length === 0 && <p className="text-xs text-muted-foreground">No collaborators yet. They must already have a Nimbus account.</p>}
      </div>

      {repo.orgId && (
        <div className="grid gap-2">
          <h3 className="text-sm font-medium">Teams</h3>
          {access.granted.length > 0 && (
            <ul className={LIST}>
              {access.granted.map((g) => (
                <li key={g.teamId} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                  <span className="min-w-0 flex-1 basis-44 truncate text-sm font-medium">{g.name}</span>
                  <select
                    aria-label={`Role of team ${g.name}`}
                    value={g.role}
                    disabled={pending}
                    onChange={(e) => run(() => setTeamRepo(g.teamId, repo.id, e.target.value))}
                    className={SEL}
                  >
                    {GRANTS.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={TOUCH}
                    aria-label={`Remove team ${g.name}`}
                    disabled={pending}
                    onClick={() => run(() => setTeamRepo(g.teamId, repo.id, null), `${g.name} removed.`)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {access.teams.length === 0 ? (
            <p className="text-xs text-pretty text-muted-foreground">
              This org has no teams. An org owner can make one under{" "}
              <Link href="/registry?tab=access" className="rounded-sm text-foreground underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                Access → Orgs
              </Link>
              .
            </p>
          ) : (
            free.length > 0 && (
              <form
                className="flex flex-wrap gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  const f = new FormData(e.currentTarget)
                  run(() => setTeamRepo(String(f.get("team") ?? ""), repo.id, String(f.get("role") ?? "read")), "Team added.")
                }}
              >
                <select name="team" aria-label="Team to add" className={cn(SEL, "min-w-0 flex-1 basis-48")}>
                  {free.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <select name="role" aria-label="Role for the team" defaultValue="read" className={SEL}>
                  {GRANTS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
                <SubmitButton pending={pending} variant="outline" className={TOUCH}>
                  Add team
                </SubmitButton>
              </form>
            )
          )}
        </div>
      )}
      <FormError>{error}</FormError>
    </section>
  )
}

// ---- Rename or move --------------------------------------------------------

export function RenameSection({ repo, targets }: { repo: RepoDetail; targets: string[] }) {
  const current = repo.fullName.slice(repo.namespace.length + 1)
  const [ns, setNs] = useState(repo.namespace)
  const [name, setName] = useState(current)
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()
  const router = useRouter()
  const setNotice = useNotice()
  const id = useId()
  const same = ns === repo.namespace && name.trim() === current
  const check = useNameCheck(same ? "" : `${ns}/${name.trim()}`, (k) => checkRepoName(k.slice(0, k.indexOf("/")), k.slice(k.indexOf("/") + 1)))
  const to = `${ns}/${name.trim()}`
  return (
    <section id="rename" className={cn(SECTION, "scroll-mt-20")} aria-labelledby="rename-heading">
      <Heading
        id="rename-heading"
        title="Rename or move"
        hint="Pick another name, or move it to another registry name you own. Pulls of the old name keep working for 30 days."
      />
      <form
        className="flex flex-col gap-3 rounded-xl border bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault()
          setError(undefined)
          setAsking(true)
        }}
      >
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-ns`}>Registry name</Label>
            <select id={`${id}-ns`} value={ns} disabled={targets.length < 2} onChange={(e) => setNs(e.target.value)} className={cn(SEL, "font-mono")}>
              {targets.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <span aria-hidden className="pb-2 text-muted-foreground pointer-coarse:pb-3">
            /
          </span>
          <div className="grid min-w-0 flex-1 basis-48 gap-1.5">
            <Label htmlFor={`${id}-name`}>Repository name</Label>
            <Input
              id={`${id}-name`}
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase())}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={check.state === "bad" || undefined}
              aria-describedby={`${id}-status`}
              className={cn("font-mono", FIELD)}
            />
          </div>
        </div>
        {same ? <p id={`${id}-status`} className="min-h-5 text-sm text-muted-foreground">That&apos;s its name now.</p> : <NameStatus id={`${id}-status`} check={check} />}
        <SubmitButton variant="outline" className={cn("self-start", TOUCH)} disabled={same || check.state !== "ok"}>
          Rename or move
        </SubmitButton>
      </form>
      <Dialog.Root open={asking} onOpenChange={(o) => !o && !pending && setAsking(false)}>
        <Dialog.Portal>
          <Dialog.Backdrop className={DIALOG_BACKDROP} />
          <Dialog.Popup className={DIALOG_POPUP}>
            <div className="grid gap-1.5">
              <Dialog.Title className="text-base font-semibold">Rename or move this repository?</Dialog.Title>
              <Dialog.Description className="text-sm text-pretty text-muted-foreground">
                <span className="font-mono break-all text-foreground">{repo.fullName}</span> becomes{" "}
                <span className="font-mono break-all text-foreground">{to}</span>. Pulls of the old name keep working for 30 days, then stop. Pushes to the old
                name are refused right away, so update your Dockerfiles, compose files and CI.
              </Dialog.Description>
            </div>
            <FormError>{error}</FormError>
            <div className="flex justify-end gap-2">
              <Dialog.Close disabled={pending} render={<Button variant="outline" className={TOUCH} />}>
                Cancel
              </Dialog.Close>
              <Button
                className={TOUCH}
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await renameRepo(repo.id, { namespace: ns, name: name.trim() })
                    if (r.error || !r.fullName) return setError(r.error ?? "Couldn't rename it.")
                    setAsking(false)
                    setNotice({ text: `Now ${r.fullName}. The old name works for pulls for 30 days.` })
                    router.replace(`/registry/${r.fullName}?tab=settings`)
                  })
                }
              >
                Rename
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  )
}

// ---- Archive ---------------------------------------------------------------

export function ArchiveSection({ repo }: { repo: RepoDetail }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string>()
  const setNotice = useNotice()
  const flip = (to: boolean) =>
    start(async () => {
      setError(undefined)
      const r = await setArchived(repo.id, to)
      if (r.error) return setError(r.error)
      setNotice({ text: to ? "Archived. It's read-only now." : "Unarchived. Pushes and deletes work again." })
    })
  return (
    <section id="archive" className={cn(SECTION, "scroll-mt-20")} aria-labelledby="archive-heading">
      <Heading
        id="archive-heading"
        title="Archive"
        hint="Keep the images for pulls but stop changes. Pushes and deletes are refused and cleanup rules skip it. Unarchive any time."
      />
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
        <span className="flex min-w-0 flex-1 basis-56 items-center gap-2 text-sm font-medium">
          <ArchiveIcon className="size-4" />
          {repo.archived ? "This repository is archived" : "Not archived"}
          {repo.archived && <Badge variant="secondary">Archived</Badge>}
        </span>
        {repo.archived ? (
          <Button variant="outline" size="sm" className={TOUCH} disabled={pending} onClick={() => flip(false)}>
            Unarchive
          </Button>
        ) : (
          <Confirm
            label="Archive repository"
            question="Pushes and deletes stop until you unarchive."
            yes="Archive"
            danger={false}
            pending={pending}
            onYes={() => flip(true)}
          />
        )}
        <FormError>{error}</FormError>
      </div>
    </section>
  )
}
