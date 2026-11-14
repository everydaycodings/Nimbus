"use client"

import { GearIcon, GlobeIcon, LockSimpleIcon, PackageIcon } from "@phosphor-icons/react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import { deleteRepo, deleteTag, setImmutable, setRepoPublic } from "@/app/(app)/registry/actions"
import { CopyButton } from "@/components/copy-button"
import { Code, Confirm, Empty, Heading, LIST, SECTION, WHEN } from "@/components/registry-ui"
import { SubmitButton } from "@/components/submit-button"
import { useNotice } from "@/components/toaster"
import { FormError } from "@/components/two-factor"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatBytes } from "@/lib/file-types"
import type { RepoDetail, TagRow } from "@/lib/registry/manage"
import { cn } from "@/lib/utils"

export function RepoTags({ repo, host, selected }: { repo: RepoDetail; host: string; selected?: string }) {
  const empty = repo.tags.length === 0
  const ns = repo.fullName.split("/")[0]
  return (
    <section className={SECTION} aria-labelledby="tags-heading">
      <Heading id="tags-heading" title="Tags" hint="Pick a tag for its layers, config and history." />
      {empty ? (
        <Empty icon={PackageIcon} title="No tags">
          Push an image to this repository:
          <Code>{`docker login ${host} -u ${ns}\ndocker tag myimage ${host}/${repo.fullName}:latest\ndocker push ${host}/${repo.fullName}:latest`}</Code>
        </Empty>
      ) : (
        <ul className={LIST}>
          {repo.tags.map((t) => (
            <TagItem key={t.name} t={t} repo={repo} host={host} selected={selected === t.name} />
          ))}
        </ul>
      )}
    </section>
  )
}

function TagItem({ t, repo, host, selected }: { t: TagRow; repo: RepoDetail; host: string; selected: boolean }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string>()
  const router = useRouter()
  const setNotice = useNotice()
  const pull = `docker pull ${host}/${repo.fullName}:${t.name}`
  return (
    <li className={cn("flex flex-col gap-2 px-4 py-3", selected && "bg-accent/30")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="grid min-w-0 flex-1 basis-64 gap-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <Link
              href={`/registry/${repo.fullName}?tag=${encodeURIComponent(t.name)}#detail`}
              className="rounded-sm font-mono break-all underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {t.name}
            </Link>
            {t.immutable && <Badge variant="secondary">Immutable</Badge>}
            {t.platforms.map((p) => (
              <Badge key={p} variant="outline" className="font-mono">
                {p}
              </Badge>
            ))}
          </p>
          <p suppressHydrationWarning className="text-xs text-pretty text-muted-foreground">
            <span className="tabular-nums">{formatBytes(t.bytes)}</span> · Pushed {WHEN.format(new Date(t.pushedAt))}
            {t.pushedBy ? ` by ${t.pushedBy}` : ""} ·{" "}
            {t.lastPulledAt ? `Last pulled ${WHEN.format(new Date(t.lastPulledAt))}` : "Never pulled"}
          </p>
          <code className="truncate font-mono text-[11px] text-muted-foreground" title={t.digest}>
            {t.digest}
          </code>
        </div>
        <CopyButton value={pull} />
        {repo.canWrite && (
          <Confirm
            label="Delete"
            question="Pulls of this tag stop."
            yes="Delete tag"
            pending={pending}
            onYes={() =>
              start(async () => {
                const r = await deleteTag(repo.fullName, t.name)
                if (r.error) return setError(r.error)
                setNotice({ text: `Deleted tag “${t.name}”.` })
                if (selected) router.replace(`/registry/${repo.fullName}`)
              })
            }
          />
        )}
      </div>
      <code className="block overflow-x-auto rounded-md bg-input/20 px-2.5 py-1.5 font-mono text-xs whitespace-pre text-muted-foreground select-all">
        {pull}
      </code>
      <FormError>{error}</FormError>
    </li>
  )
}

export function RepoSettings({ repo }: { repo: RepoDetail }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string>()
  const [isPublic, setPublic] = useState(repo.isPublic)
  const router = useRouter()
  const setNotice = useNotice()
  if (!repo.canWrite) return null
  return (
    <section className={SECTION} aria-labelledby="settings-heading">
      <Heading id="settings-heading" title="Settings" hint="Who can pull this repository, which tags are locked, and deleting it." />
      <div className="flex flex-col gap-5 rounded-xl border bg-card p-4">
        <label className="flex cursor-pointer items-start gap-3 text-sm">
          <input
            type="checkbox"
            role="switch"
            checked={isPublic}
            disabled={pending || (!repo.publicAllowed && !isPublic)}
            onChange={(e) => {
              const next = e.target.checked
              setPublic(next)
              setError(undefined)
              start(async () => {
                const r = await setRepoPublic(repo.fullName, next)
                if (r.error) {
                  setPublic(!next)
                  return setError(r.error)
                }
                setNotice({ text: next ? "Anyone can now pull this repository." : "This repository is private again." })
              })
            }}
            className="mt-0.5 size-4 accent-primary"
          />
          <span className="grid gap-0.5">
            <span className="flex items-center gap-1.5 font-medium">
              {isPublic ? <GlobeIcon className="size-4" /> : <LockSimpleIcon className="size-4" />}
              Public
            </span>
            <span className="text-xs text-pretty text-muted-foreground">
              {repo.publicAllowed
                ? "Anyone can pull without signing in. Only you and your org can push."
                : "An admin turned off public repositories on this server."}
            </span>
          </span>
        </label>

        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const v = String(new FormData(e.currentTarget).get("pattern") ?? "")
            setError(undefined)
            start(async () => {
              const r = await setImmutable(repo.fullName, v)
              if (r.error) return setError(r.error)
              setNotice({ text: v.trim() ? "Immutable tags saved." : "No tags are immutable now." })
              router.refresh()
            })
          }}
        >
          <Label htmlFor="immutable">Immutable tags</Label>
          <p className="text-xs text-pretty text-muted-foreground">
            Tags matching this can&apos;t be overwritten or deleted. A glob like <code className="font-mono">v*</code>, comma
            separated, or <code className="font-mono">re:^v\d+$</code> for a regex. Blank for none.
          </p>
          <div className="flex gap-2">
            <Input id="immutable" name="pattern" defaultValue={repo.immutablePattern ?? ""} placeholder="v*" className="font-mono" />
            <SubmitButton pending={pending} variant="outline">
              Save
            </SubmitButton>
          </div>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
          <span className="grid gap-0.5 text-sm">
            <span className="flex items-center gap-1.5 font-medium">
              <GearIcon className="size-4" />
              Delete repository
            </span>
            <span className="text-xs text-muted-foreground">Removes it and every tag from view.</span>
          </span>
          <Confirm
            label="Delete repository"
            question="Pulls and pushes stop."
            yes="Delete"
            pending={pending}
            onYes={() =>
              start(async () => {
                const r = await deleteRepo(repo.fullName)
                if (r.error) return setError(r.error)
                setNotice({ text: `Deleted ${repo.fullName}.` })
                router.replace("/registry")
              })
            }
          />
        </div>
        <FormError>{error}</FormError>
      </div>
    </section>
  )
}
