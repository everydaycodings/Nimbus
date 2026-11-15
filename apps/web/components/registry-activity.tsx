"use client"

import { ClockCounterClockwiseIcon } from "@phosphor-icons/react"
import { useRef, useState, useTransition } from "react"

import { activityPage, type ActivityScope } from "@/app/(app)/registry/actions"
import { Empty, LIST, SELECT, WHEN } from "@/components/registry-ui"
import { UserAvatar } from "@/components/user-avatar"
import { Button } from "@/components/ui/button"
import { FormError } from "@/components/two-factor"
import { cn } from "@/lib/utils"

export type ActivityEvent = {
  id: string
  repoId: string | null
  repoName: string | null
  actorId: string | null
  actorName: string
  actorImage: string | null
  action: string
  detail: Record<string, unknown> | null
  ip: string | null
  at: string
}
export type ActivityPage = { rows: ActivityEvent[]; more: boolean }

const GRANT: Record<string, string> = { read: "Read", write: "Write", admin: "Admin" }
const text = (v: unknown) => (typeof v === "string" ? v : "")

// What the log line says, in plain words. Unknown codes read as their code with spaces.
export function sentence(e: ActivityEvent): string {
  const d = e.detail ?? {}
  const repo = e.repoName ?? ""
  const who = text(d.who) || text(d.email) || "a member"
  const tag = text(d.tag)
  switch (e.action) {
    case "push":
      return `pushed ${repo ? `${repo}:` : ""}${tag}`
    case "tag_delete":
      return `deleted tag ${tag}`
    case "manifest_delete": {
      const tags = Array.isArray(d.tags) ? d.tags.filter((t): t is string => typeof t === "string") : []
      return tags.length ? `deleted an image (${tags.join(", ")})` : "deleted an untagged image"
    }
    case "repo_create":
      return `created ${text(d.name) || repo}${d.by === "push" ? " with a push" : ""}`
    case "rename":
      return `renamed ${text(d.from)} to ${text(d.to)}`
    case "archive":
      return "archived the repository"
    case "unarchive":
      return "unarchived the repository"
    case "description":
      return d.text ? "edited the description" : "reset the description to the image label"
    case "collaborator_add":
      return `added ${who} as ${GRANT[text(d.role)] ?? text(d.role)}`
    case "collaborator_role":
      return `made ${who} ${GRANT[text(d.role)] ?? text(d.role)}`
    case "collaborator_remove":
      return `removed ${who} from the collaborators`
    case "team_create":
      return `created team ${text(d.team)}`
    case "team_rename":
      return `renamed team ${text(d.from)} to ${text(d.to)}`
    case "team_delete":
      return `deleted team ${text(d.team)}`
    case "team_member_add":
      return `added ${who} to team ${text(d.team)}`
    case "team_member_remove":
      return `removed ${who} from team ${text(d.team)}`
    case "team_repo":
      return d.role ? `gave team ${text(d.team)} ${GRANT[text(d.role)] ?? text(d.role)} access` : `removed team ${text(d.team)}'s access`
    case "visibility":
      return d.public ? "made the repository public" : "made the repository private"
    case "immutable":
      return d.pattern ? `locked tags matching ${text(d.pattern)}` : "turned off immutable tags"
    case "block_critical":
      return d.on ? "blocked pulls of images with critical vulnerabilities" : "allowed pulls of images with critical vulnerabilities"
    case "repo_delete":
      return `moved ${text(d.name) || repo} to Trash`
    case "restore":
      return `restored ${text(d.tag) ? `tag ${text(d.tag)}` : text(d.name) ? text(d.name) : "an image"} from Trash`
    case "trash_purge":
      return `deleted ${text(d.tag) ? `tag ${text(d.tag)}` : text(d.name) || "an image"} from Trash for good`
    case "policy":
      return d.inherit ? "set cleanup to follow the registry name's rules" : text(d.scope) ? `changed the cleanup rules for ${text(d.scope)}` : "changed the cleanup rules"
    case "cleanup_run":
      return "ran cleanup"
    case "hook_add":
      return `added a webhook to ${text(d.url)}`
    case "hook_remove":
      return "removed a webhook"
    case "token_create":
      return `made a token “${text(d.name)}”`
    case "token_revoke":
      return `revoked the token “${text(d.name)}”`
    case "token_use":
      return "used a token"
    default:
      return e.action.replace(/_/g, " ")
  }
}

const rel = new Intl.RelativeTimeFormat("en", { numeric: "auto" })
function since(iso: string) {
  const s = (Date.parse(iso) - Date.now()) / 1000
  for (const [unit, n] of [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ] as const)
    if (Math.abs(s) >= n) return rel.format(Math.round(s / n), unit)
  return "just now"
}

function Row({ e, showRepo }: { e: ActivityEvent; showRepo: boolean }) {
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <UserAvatar name={e.actorName} image={e.actorImage} size={32} />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <p className="text-sm text-pretty break-words">
          <span className="font-medium">{e.actorName}</span> {sentence(e)}
          {showRepo && e.repoName && <span className="ml-2 font-mono text-xs text-muted-foreground">{e.repoName}</span>}
        </p>
        <p suppressHydrationWarning className="text-xs text-muted-foreground">
          <time dateTime={e.at} title={WHEN.format(new Date(e.at))}>
            {since(e.at)}
          </time>
          {e.ip ? ` · ${e.ip}` : ""}
        </p>
      </div>
    </li>
  )
}

// `repos`: when given (a whole registry name), a repository filter appears. The people filter lists whoever the log has shown so far.
export function ActivityList({
  scope,
  initial,
  repos,
  className,
}: {
  scope: ActivityScope
  initial: ActivityPage
  repos?: { id: string; name: string }[]
  className?: string
}) {
  const [page, setPage] = useState(initial)
  const [actor, setActor] = useState("")
  const [repo, setRepo] = useState("")
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()
  const people = useRef(new Map<string, string>())
  for (const e of page.rows) if (e.actorId) people.current.set(e.actorId, e.actorName)
  const load = (next: { actor: string; repo: string }, more: boolean) =>
    start(async () => {
      setError(undefined)
      try {
        const r = await activityPage(scope, {
          actorId: next.actor || undefined,
          repoId: next.repo || undefined,
          before: more ? page.rows[page.rows.length - 1]?.at : undefined,
        })
        setPage(more ? { rows: [...page.rows, ...r.rows], more: r.more } : r)
      } catch {
        setError("Couldn't load the activity. Try again.")
      }
    })
  const filtered = Boolean(actor || repo)
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {(people.current.size > 1 || filtered || repos) && (
        <div className="flex flex-wrap gap-2">
          <select
            aria-label="Filter by person"
            value={actor}
            disabled={pending}
            onChange={(e) => {
              setActor(e.target.value)
              load({ actor: e.target.value, repo }, false)
            }}
            className={cn(SELECT, "max-w-full pointer-coarse:h-11")}
          >
            <option value="">Everyone</option>
            {[...people.current].map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          {repos && repos.length > 0 && (
            <select
              aria-label="Filter by repository"
              value={repo}
              disabled={pending}
              onChange={(e) => {
                setRepo(e.target.value)
                load({ actor, repo: e.target.value }, false)
              }}
              className={cn(SELECT, "max-w-full pointer-coarse:h-11")}
            >
              <option value="">All repositories</option>
              {repos.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      {page.rows.length === 0 ? (
        <Empty icon={ClockCounterClockwiseIcon} title={filtered ? "Nothing matches" : "No activity yet"}>
          {filtered ? "Nothing in the last 90 days matches those filters." : "Pushes, deletes and changes to access show up here for 90 days."}
        </Empty>
      ) : (
        <ul className={cn(LIST, pending && "opacity-60")}>
          {page.rows.map((e) => (
            <Row key={e.id} e={e} showRepo={"namespaceId" in scope} />
          ))}
        </ul>
      )}
      <FormError>{error}</FormError>
      {page.more && (
        <Button variant="outline" className="self-start pointer-coarse:h-11" disabled={pending} onClick={() => load({ actor, repo }, true)}>
          {pending ? "Loading…" : "Load more"}
        </Button>
      )}
    </div>
  )
}
