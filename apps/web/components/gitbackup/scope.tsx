"use client"

import { useEffect, useId, useMemo, useState } from "react"

import { loadRepos } from "@/app/(app)/more/github-backup/actions"
import { LIST, RADIO, RADIO_INPUT, Switch } from "@/components/registry-ui"
import type { Ref } from "@/lib/gitbackup/connections"
import type { RepoList } from "@/lib/gitbackup/github"
import { cn } from "@/lib/utils"
import { Picker } from "./picker"

// What a job backs up. Stored in the job's autoOwners: ["*"] everything, owner logins whole accounts, empty chosen repos only;
// "Choose repos" with new ones from owners sends those owners with newOnly (lib/gitbackup/refs.ts scopeRule).
export type Scope = { mode: "all" | "owners" | "repos"; owners: string[]; repos: string[]; extra: string[] }

export const emptyScope: Scope = { mode: "repos", owners: [], repos: [], extra: [] }
export const scopeOwners = (s: Scope) => (s.mode === "all" ? ["*"] : s.mode === "owners" ? s.owners : s.extra)
export const scopeReady = (s: Scope) => (s.mode === "all" ? true : s.mode === "owners" ? s.owners.length > 0 : s.repos.length > 0)
export const scopeNewOnly = (s: Scope) => s.mode === "repos"
export const scopeFromJob = (autoOwners: string[], newOnly: boolean): Scope =>
  autoOwners[0] === "*" ? { ...emptyScope, mode: "all" } : newOnly ? { ...emptyScope, extra: autoOwners } : autoOwners.length ? { ...emptyScope, mode: "owners", owners: autoOwners } : emptyScope

const CHOICES = [
  ["all", "Everything this token can see", "Every repo, personal and in every organization, including ones added later. Forks and archived repos are included; an archived repo never changes, so it costs one snapshot."],
  ["owners", "Whole accounts or organizations", "Pick owners. All their repos are added now, and new ones join on their own. Forks and archived repos are included."],
  ["repos", "Choose repos", "Pick exactly the repos you want."],
] as const

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

// `picker`: show the repo picker in "Choose repos" (the wizard); in Settings repos are added from the Repos tab.
export function ScopeFields({ connection, value, onChange, picker }: { connection: Ref; value: Scope; onChange: (s: Scope) => void; picker: boolean }) {
  const id = useId()
  const [data, setData] = useState<RepoList | null>(null)
  const key = connection.connectionId ?? connection.registryConnectionId
  useEffect(() => {
    let live = true
    loadRepos(connection, false).then((r) => live && !("error" in r) && setData(r), () => {})
    return () => {
      live = false
    }
    // Re-read when the connection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of data?.repos ?? []) m.set(r.owner.toLowerCase(), (m.get(r.owner.toLowerCase()) ?? 0) + 1)
    return m
  }, [data])
  const toggle = (list: string[], login: string, on: boolean) => (on ? [...list, login] : list.filter((o) => !same(o, login)))
  const ownerRows = (list: string[], set: (l: string[]) => void, showCount: boolean) => (
    <ul className={LIST}>
      {data!.owners.map((o) => (
        <li key={o.login}>
          <label className="flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2 hover:bg-accent/40 has-focus-visible:bg-accent/40">
            {showCount ? (
              <input type="checkbox" className="size-4 shrink-0 accent-primary" checked={list.some((x) => same(x, o.login))} onChange={(e) => set(toggle(list, o.login, e.target.checked))} />
            ) : null}
            <span className="min-w-0 flex-1 truncate text-sm font-medium" title={o.login}>
              {o.login}
              {o.me ? <span className="font-normal text-muted-foreground"> (you)</span> : null}
            </span>
            <span className="text-sm text-muted-foreground tabular-nums">{counts.get(o.login.toLowerCase()) ?? 0} {(counts.get(o.login.toLowerCase()) ?? 0) === 1 ? "repo" : "repos"}</span>
            {!showCount && <Switch aria-label={`New repos from ${o.login}`} checked={list.some((x) => same(x, o.login))} onChange={(e) => set(toggle(list, o.login, e.target.checked))} />}
          </label>
        </li>
      ))}
    </ul>
  )

  return (
    <div className="flex flex-col gap-4">
      <div role="radiogroup" aria-label="What to back up" className="grid gap-2">
        {CHOICES.map(([mode, title, text]) => (
          <label key={mode} className={cn(RADIO, "items-start")}>
            <input type="radio" name={`${id}-scope`} className={cn(RADIO_INPUT, "mt-0.5")} checked={value.mode === mode} onChange={() => onChange({ ...value, mode })} />
            <span className="grid gap-0.5">
              <span className="font-medium">{title}</span>
              <span className="text-pretty text-muted-foreground">{text}</span>
            </span>
          </label>
        ))}
      </div>
      {value.mode === "owners" && (data ? ownerRows(value.owners, (owners) => onChange({ ...value, owners }), true) : <p className="text-sm text-muted-foreground">Loading owners…</p>)}
      {value.mode === "repos" && (
        <>
          {picker && <Picker key={key} connection={connection} picked={value.repos} onPick={(repos) => onChange({ ...value, repos })} />}
          {data && data.owners.length > 0 && (
            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium">Also add new repos from…</legend>
              <p className="text-sm text-pretty text-muted-foreground">Repos created there later join this job on their own. Repos that exist now stay as chosen.</p>
              {ownerRows(value.extra, (extra) => onChange({ ...value, extra }), false)}
            </fieldset>
          )}
        </>
      )}
    </div>
  )
}
