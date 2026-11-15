"use client"

import { ArrowLeftIcon, UsersThreeIcon } from "@phosphor-icons/react"
import { useEffect, useState, useTransition } from "react"

import {
  addTeamMember,
  createTeam,
  deleteTeam,
  orgTeams,
  removeTeamMember,
  renameTeam,
  setTeamRepo,
} from "@/app/(app)/registry/actions"
import { Confirm, Empty, LIST, SELECT, TOUCH } from "@/components/registry-ui"
import { useNotice } from "@/components/toaster"
import { FormError } from "@/components/two-factor"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { OrgMember, RepoRow } from "@/lib/registry/manage"
import { cn } from "@/lib/utils"

type Team = Awaited<ReturnType<typeof orgTeams>>[number]
const GRANTS = [
  ["read", "Read"],
  ["write", "Write"],
  ["admin", "Admin"],
] as const
const SEL = cn(SELECT, "pointer-coarse:h-11")
const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`)

// The Teams view of the org dialog: a list, and one team's page with its members and repositories.
export function OrgTeams({ orgId, orgName, members, repos }: { orgId: string; orgName: string; members: OrgMember[]; repos: RepoRow[] }) {
  const [teams, setTeams] = useState<Team[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()
  const setNotice = useNotice()
  useEffect(() => {
    let live = true
    orgTeams(orgId).then((t) => live && setTeams(t))
    return () => {
      live = false
    }
  }, [orgId])
  const run = (fn: () => Promise<{ error?: string }>, ok?: string, after?: () => void) =>
    start(async () => {
      setError(undefined)
      const r = await fn()
      if (r.error) return setError(r.error)
      setTeams(await orgTeams(orgId))
      if (ok) setNotice({ text: ok })
      after?.()
    })
  if (!teams) return <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
  const team = teams.find((t) => t.id === open)
  const orgRepos = repos.filter((r) => r.namespace === orgName)

  if (team) {
    const free = members.filter((m) => !team.members.some((x) => x.userId === m.userId))
    const freeRepos = orgRepos.filter((r) => !team.repos.some((x) => x.repoId === r.id))
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" className={TOUCH} onClick={() => setOpen(null)}>
            <ArrowLeftIcon />
            All teams
          </Button>
        </div>
        <form
          key={team.name}
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            run(() => renameTeam(team.id, String(new FormData(e.currentTarget).get("name") ?? "")), "Team renamed.")
          }}
        >
          <Input aria-label="Team name" name="name" defaultValue={team.name} maxLength={40} required className="pointer-coarse:h-11" />
          <Button type="submit" variant="outline" className={TOUCH} disabled={pending}>
            Rename
          </Button>
        </form>

        <div className="grid gap-2">
          <h3 className="text-sm font-medium">Members</h3>
          {team.members.length > 0 && (
            <ul className={LIST}>
              {team.members.map((m) => (
                <li key={m.userId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <span className="grid min-w-0 flex-1 basis-40">
                    <span className="truncate text-sm">{m.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{m.email}</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={TOUCH}
                    aria-label={`Remove ${m.name} from ${team.name}`}
                    disabled={pending}
                    onClick={() => run(() => removeTeamMember(team.id, m.userId), `${m.name} removed.`)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {free.length > 0 ? (
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                run(() => addTeamMember(team.id, String(new FormData(e.currentTarget).get("user") ?? "")), "Member added.")
              }}
            >
              <select name="user" aria-label="Org member to add" className={cn(SEL, "min-w-0 flex-1 basis-48")}>
                {free.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </select>
              <Button type="submit" variant="outline" className={TOUCH} disabled={pending}>
                Add
              </Button>
            </form>
          ) : (
            <p className="text-xs text-muted-foreground">Everyone in the org is on this team.</p>
          )}
        </div>

        <div className="grid gap-2">
          <h3 className="text-sm font-medium">Repositories</h3>
          {team.repos.length > 0 && (
            <ul className={LIST}>
              {team.repos.map((r) => (
                <li key={r.repoId} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
                  <span className="min-w-0 flex-1 basis-40 truncate font-mono text-sm">{r.name}</span>
                  <select
                    aria-label={`Role of ${team.name} on ${r.name}`}
                    value={r.role}
                    disabled={pending}
                    onChange={(e) => run(() => setTeamRepo(team.id, r.repoId, e.target.value))}
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
                    aria-label={`Remove ${r.name} from ${team.name}`}
                    disabled={pending}
                    onClick={() => run(() => setTeamRepo(team.id, r.repoId, null), `${r.name} removed.`)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {freeRepos.length > 0 ? (
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                const f = new FormData(e.currentTarget)
                run(() => setTeamRepo(team.id, String(f.get("repo") ?? ""), String(f.get("role") ?? "read")), "Repository added.")
              }}
            >
              <select name="repo" aria-label="Repository to add" className={cn(SEL, "min-w-0 flex-1 basis-48 font-mono")}>
                {freeRepos.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <select name="role" aria-label="Role" defaultValue="read" className={SEL}>
                {GRANTS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              <Button type="submit" variant="outline" className={TOUCH} disabled={pending}>
                Add
              </Button>
            </form>
          ) : (
            <p className="text-xs text-muted-foreground">{orgRepos.length ? "The team reaches every repository in the org." : "This org has no repositories yet."}</p>
          )}
        </div>
        <FormError>{error}</FormError>
        <div>
          <Confirm
            label="Delete team"
            question="Its members keep their org role."
            yes="Delete"
            pending={pending}
            onYes={() => run(() => deleteTeam(team.id), `Team “${team.name}” deleted.`, () => setOpen(null))}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-pretty text-muted-foreground">
        A team gives a group of org members Read, Write or Admin on chosen repositories, on top of their org role.
      </p>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const form = e.currentTarget
          run(async () => {
            const r = await createTeam(orgId, String(new FormData(form).get("name") ?? ""))
            if (!r.error) form.reset()
            return r
          }, "Team created.")
        }}
      >
        <Input aria-label="New team name" name="name" required maxLength={40} placeholder="New team name" className="min-w-0 flex-1 basis-48 pointer-coarse:h-11" />
        <Button type="submit" variant="outline" className={TOUCH} disabled={pending}>
          Create team
        </Button>
      </form>
      <FormError>{error}</FormError>
      {teams.length === 0 ? (
        <Empty icon={UsersThreeIcon} title="No teams yet">
          Make one, then add members and the repositories it can reach.
        </Empty>
      ) : (
        <ul className={LIST}>
          {teams.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <span className="grid min-w-0 flex-1 basis-40">
                <span className="truncate text-sm font-medium">{t.name}</span>
                <span className="text-xs text-muted-foreground">
                  {count(t.members.length, "member", "members")} · {count(t.repos.length, "repository", "repositories")}
                </span>
              </span>
              <Button variant="outline" size="sm" className={TOUCH} aria-label={`Manage team ${t.name}`} onClick={() => setOpen(t.id)}>
                Manage
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
