"use client"

import { ArrowClockwiseIcon, ArchiveIcon, GitForkIcon, LockSimpleIcon, MagnifyingGlassIcon } from "@phosphor-icons/react"
import { useEffect, useId, useMemo, useState } from "react"

import { loadRepos } from "@/app/(app)/more/github-backup/actions"
import { Empty } from "@/components/empty-state"
import { LIST, SELECT, Switch, TOUCH } from "@/components/registry-ui"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatBytes } from "@/lib/file-rules"
import type { Ref } from "@/lib/gitbackup/connections"
import type { RepoList } from "@/lib/gitbackup/github"
import { cn } from "@/lib/utils"
import { ago } from "./format"

const PAGE = 100

// Every repo the connection can see: search, filter by owner or visibility, sort, select. `exclude`: full names a job already has.
function PickerBody({ connection, picked, onPick, exclude = [] }: { connection: Ref; picked: string[]; onPick: (v: string[]) => void; exclude?: string[] }) {
  const id = useId()
  const [data, setData] = useState<RepoList | null>(null)
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState("")
  const [owner, setOwner] = useState("")
  const [vis, setVis] = useState<"all" | "public" | "private">("all")
  const [forks, setForks] = useState(false)
  const [archived, setArchived] = useState(false)
  const [sort, setSort] = useState<"pushed" | "name" | "size">("pushed")
  const [limit, setLimit] = useState(PAGE)
  const key = connection.connectionId ?? connection.registryConnectionId

  const fetchRepos = (refresh: boolean) =>
    loadRepos(connection, refresh).then(
      (r) => {
        if ("error" in r) setError(r.error)
        else setData(r)
        setLoading(false)
      },
      () => (setError("Couldn't load your repos. Check your connection and try again."), setLoading(false))
    )
  const load = () => {
    setLoading(true)
    setError(undefined)
    fetchRepos(true)
  }
  useEffect(() => {
    fetchRepos(false)
    // The parent remounts this when the connection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const taken = useMemo(() => new Set(exclude.map((e) => e.toLowerCase())), [exclude])
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase()
    const rows = (data?.repos ?? []).filter(
      (r) => !taken.has(r.fullName.toLowerCase()) && (!owner || r.owner === owner) && (vis === "all" || (vis === "private") === r.private) && (forks || !r.fork) && (archived || !r.archived) && (!n || r.fullName.toLowerCase().includes(n))
    )
    return rows.sort((a, b) => (sort === "name" ? a.fullName.localeCompare(b.fullName) : sort === "size" ? b.size - a.size : (b.pushedAt ?? "").localeCompare(a.pushedAt ?? "")))
  }, [data, q, owner, vis, forks, archived, sort, taken])
  const sel = new Set(picked)
  const allOn = shown.length > 0 && shown.every((r) => sel.has(r.fullName))
  const toggle = (name: string) => onPick(sel.has(name) ? picked.filter((p) => p !== name) : [...picked, name])

  if (error && !data)
    return (
      <div className="flex flex-col items-start gap-3 rounded-xl border p-4">
        <p role="alert" className="text-sm text-pretty text-destructive">{error}</p>
        <Button variant="outline" className={TOUCH} onClick={() => load()}>
          Try again
        </Button>
      </div>
    )
  if (!data)
    return (
      <div className="grid gap-2" aria-busy="true" aria-label="Loading repos">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
        ))}
      </div>
    )
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div className="relative">
          <Label htmlFor={`${id}-q`} className="sr-only">
            Search repos
          </Label>
          <MagnifyingGlassIcon aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input id={`${id}-q`} type="search" value={q} onChange={(e) => (setQ(e.target.value), setLimit(PAGE))} placeholder="Search repos" className="pl-9 pointer-coarse:h-11" autoComplete="off" />
        </div>
        <Button type="button" variant="outline" className={TOUCH} disabled={loading} onClick={() => load()} title={`Updated ${ago(data.at)}`}>
          <ArrowClockwiseIcon className={cn(loading && "animate-spin motion-reduce:animate-none")} />
          Refresh
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <Label htmlFor={`${id}-o`} className="text-muted-foreground">Owner</Label>
          <select id={`${id}-o`} value={owner} onChange={(e) => (setOwner(e.target.value), setLimit(PAGE))} className={cn(SELECT, "max-w-44 pointer-coarse:h-11")}>
            <option value="">All</option>
            {data.owners.map((o) => (
              <option key={o.login} value={o.login}>
                {o.login}
                {o.me ? " (you)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor={`${id}-v`} className="text-muted-foreground">Show</Label>
          <select id={`${id}-v`} value={vis} onChange={(e) => (setVis(e.target.value as typeof vis), setLimit(PAGE))} className={cn(SELECT, "pointer-coarse:h-11")}>
            <option value="all">Public and private</option>
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor={`${id}-s`} className="text-muted-foreground">Sort</Label>
          <select id={`${id}-s`} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className={cn(SELECT, "pointer-coarse:h-11")}>
            <option value="pushed">Last push</option>
            <option value="name">Name</option>
            <option value="size">Size</option>
          </select>
        </div>
        <label className="flex min-h-9 items-center gap-2 text-sm">
          <Switch checked={forks} onChange={(e) => setForks(e.target.checked)} />
          Forks
        </label>
        <label className="flex min-h-9 items-center gap-2 text-sm">
          <Switch checked={archived} onChange={(e) => setArchived(e.target.checked)} />
          Archived
        </label>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center justify-between gap-3 text-sm">
        <label className="flex min-h-9 items-center gap-2">
          <input type="checkbox" className="size-4 accent-primary" checked={allOn} disabled={!shown.length} onChange={() => onPick(allOn ? picked.filter((p) => !shown.some((r) => r.fullName === p)) : [...new Set([...picked, ...shown.map((r) => r.fullName)])])} />
          Select all {shown.length} shown
        </label>
        <p aria-live="polite" className="tabular-nums text-muted-foreground">{picked.length} selected</p>
      </div>
      {shown.length === 0 ? (
        <Empty icon={MagnifyingGlassIcon} title={data.repos.length ? "No repos match" : "No repos found"}>
          {data.repos.length ? "Try a different search, or turn on forks and archived repos." : "This token can't see any repos. Check its scopes, then refresh."}
        </Empty>
      ) : (
        <ul className={LIST}>
          {shown.slice(0, limit).map((r) => (
            <li key={r.fullName}>
              <label className="flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2 hover:bg-accent/40 has-focus-visible:bg-accent/40">
                <input type="checkbox" className="size-4 shrink-0 accent-primary" checked={sel.has(r.fullName)} onChange={() => toggle(r.fullName)} />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium" title={r.fullName}>{r.fullName}</span>
                    {r.private && <LockSimpleIcon aria-label="Private" className="size-3.5 shrink-0 text-muted-foreground" />}
                    {r.fork && <GitForkIcon aria-label="Fork" className="size-3.5 shrink-0 text-muted-foreground" />}
                    {r.archived && (
                      <Badge variant="outline">
                        <ArchiveIcon aria-hidden />
                        Archived
                      </Badge>
                    )}
                  </span>
                  <span className="block text-xs text-muted-foreground tabular-nums">
                    Pushed {ago(r.pushedAt, "never")} · {formatBytes(r.size)}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {shown.length > limit && (
        <Button type="button" variant="outline" className={cn(TOUCH, "w-fit")} onClick={() => setLimit((l) => l + PAGE)}>
          Show more ({shown.length - limit} left)
        </Button>
      )}
    </div>
  )
}

export function Picker(props: Parameters<typeof PickerBody>[0]) {
  return <PickerBody key={props.connection.connectionId ?? props.connection.registryConnectionId} {...props} />
}
