"use client"

import { Menu } from "@base-ui/react/menu"
import { CaretDownIcon, CopySimpleIcon, GitDiffIcon, PackageIcon, TrashIcon } from "@phosphor-icons/react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState, useTransition } from "react"

import { deleteTags, restoreTrash } from "@/app/(app)/registry/actions"
import { CopyButton } from "@/components/copy-button"
import { MENU_ITEM } from "@/components/overlay-styles"
import { PolicyBadge, type Verdict } from "@/components/registry-policy"
import { SeverityCompact, isScanning, type ScanSummary } from "@/components/registry-scan"
import { Code, Confirm, Empty, LIST, RowMenu, SECTION, SELECT, TOUCH, WHEN } from "@/components/registry-ui"
import { useNotice } from "@/components/toaster"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { sizeOf } from "@/lib/registry/size"
import type { RepoDetail, TagRow } from "@/lib/registry/manage"
import { cn } from "@/lib/utils"

// What the page knows about a tag beyond its row: scan result, attachments, pulls.
export type TagExtra = { scan: ScanSummary | null; signed: boolean; sbom: boolean; attestation: boolean; pulls: number; policy?: Verdict | null }

const FILTER_AT = 10
// Rows are separate grids, so every column but the name ones has a fixed width to line up under the header.
const COLS = "md:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_4.5rem_6.5rem_10rem_4.5rem_9rem]"
const GRID_WRITE = `grid-cols-[auto_minmax(0,1fr)_auto] md:grid-cols-[auto_minmax(0,2fr)_minmax(0,1.3fr)_4.5rem_6.5rem_10rem_4.5rem_9rem]`
const GRID_READ = `grid-cols-[minmax(0,1fr)_auto] ${COLS}`
const BOX = "grid size-5 shrink-0 cursor-pointer place-items-center pointer-coarse:size-11"

const platformText = (p: string[]) => (p.length <= 2 ? p.join(", ") : `${p.length} platforms`)

// `detail` is the server-rendered layers and config of the selected tag; it opens under that tag's row.
export function RepoTags({
  repo,
  host,
  selected,
  detail,
  scanOn,
  extras,
}: {
  repo: RepoDetail
  host: string
  selected?: string
  detail?: React.ReactNode
  scanOn: boolean
  extras: Record<string, TagExtra>
}) {
  const router = useRouter()
  const setNotice = useNotice()
  const [pending, start] = useTransition()
  const waiting = scanOn && Object.values(extras).some((x) => isScanning(x.scan))
  // A scan finishes in the worker; look again while any tag is waiting for one.
  useEffect(() => {
    if (!waiting) return
    const t = setInterval(() => router.refresh(), 5000)
    return () => clearInterval(t)
  }, [waiting, router])
  const empty = repo.tags.length === 0
  const ns = repo.fullName.split("/")[0]
  const writer = repo.canWrite && !repo.archived
  const [q, setQ] = useState("")
  const [sort, setSort] = useState<"pushed" | "name" | "severity">("pushed")
  const [sel, setSel] = useState<Set<string>>(new Set())
  const many = repo.tags.length > FILTER_AT
  const tags = useMemo(() => {
    const t = repo.tags.filter((x) => x.name.toLowerCase().includes(q.trim().toLowerCase()))
    if (sort === "name") return [...t].sort((a, b) => a.name.localeCompare(b.name))
    // Worst first: criticals, then highs; unscanned images last. Ties keep newest first.
    const rank = (n: string) => {
      const s = extras[n]?.scan
      return s?.status === "done" ? s.critical * 1_000_000 + s.high : -1
    }
    return sort === "severity" ? [...t].sort((a, b) => rank(b.name) - rank(a.name)) : t
  }, [repo.tags, q, sort, extras])
  // Tags pointing at the same image: the newest one is "the" tag, the rest say so.
  const sameAs = useMemo(() => {
    const first = new Map<string, string>()
    const out: Record<string, string> = {}
    for (const t of repo.tags) {
      const f = first.get(t.digest)
      if (f) out[t.name] = f
      else first.set(t.digest, t.name)
    }
    return out
  }, [repo.tags])

  const pickable = tags.filter((t) => !t.immutable).map((t) => t.name)
  const chosen = pickable.filter((n) => sel.has(n))
  const all = pickable.length > 0 && chosen.length === pickable.length
  const master = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (master.current) master.current.indeterminate = chosen.length > 0 && !all
  }, [chosen.length, all])

  const trash = (names: string[]) =>
    start(async () => {
      const r = await deleteTags(repo.fullName, names)
      setSel(new Set())
      if (!r.ids.length) return setNotice({ text: r.skipped[0]?.error ?? "Nothing was moved.", error: true })
      const label = r.ids.length === 1 ? `tag “${names.find((n) => !r.skipped.some((s) => s.tag === n)) ?? names[0]}”` : `${r.ids.length} tags`
      setNotice({
        text: `Moved ${label} to Trash.${r.skipped.length ? ` ${r.skipped.length} skipped: ${r.skipped[0].error}` : ""}`,
        undo: () =>
          Promise.all(r.ids.map((id) => restoreTrash("tag", id))).then((u) => {
            const bad = u.find((x) => x.error)
            setNotice(bad?.error ? { text: bad.error, error: true } : { text: r.ids.length === 1 ? "Restored the tag." : `Restored ${r.ids.length} tags.` })
            router.refresh()
          }),
      })
      if (selected && names.includes(selected)) router.replace(`/registry/${repo.fullName}?tab=tags`)
    })

  return (
    <section className={SECTION} aria-label="Tags">
      {many && (
        <div className="flex flex-wrap gap-2">
          <Input
            aria-label="Filter tags"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter tags"
            className="min-w-0 flex-1 basis-48"
          />
          <select aria-label="Sort tags" value={sort} onChange={(e) => setSort(e.target.value as "pushed" | "name" | "severity")} className={cn(SELECT, "pointer-coarse:h-11")}>
            <option value="pushed">Newest pushed</option>
            <option value="name">Name</option>
            <option value="severity">Most vulnerabilities</option>
          </select>
        </div>
      )}
      {empty ? (
        <Empty icon={PackageIcon} title="No tags">
          Push an image to this repository:
          <Code>{`docker login ${host} -u ${ns}\ndocker tag myimage ${host}/${repo.fullName}:latest\ndocker push ${host}/${repo.fullName}:latest`}</Code>
        </Empty>
      ) : tags.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">No tag matches “{q}”.</p>
      ) : (
        <div className={LIST}>
          <div className={cn("items-center gap-x-3 px-4 py-2 text-xs text-muted-foreground", writer ? "grid" : "hidden md:grid", writer ? GRID_WRITE : GRID_READ)}>
            {writer && (
              <label className={BOX}>
                <input
                  ref={master}
                  type="checkbox"
                  aria-label="Select all visible tags"
                  checked={all}
                  disabled={pickable.length === 0}
                  onChange={() => setSel(all ? new Set() : new Set(pickable))}
                  className="size-4 shrink-0 accent-primary"
                />
              </label>
            )}
            <span className="md:hidden">{writer ? "Select all" : null}</span>
            <span className="hidden md:block">Tag</span>
            <span className="hidden md:block">Platforms</span>
            <span className="hidden md:block">Size</span>
            <span className="hidden md:block">Vulnerabilities</span>
            <span className="hidden md:block">Pushed</span>
            <span className="hidden md:block">Pulls (30d)</span>
            <span className="hidden md:block" />
          </div>
          <ul className="divide-y">
            {tags.map((t) => (
              <TagItem
                key={t.name}
                t={t}
                x={extras[t.name]}
                scanOn={scanOn}
                repo={repo}
                host={host}
                writer={writer}
                busy={pending}
                same={sameAs[t.name]}
                checked={sel.has(t.name)}
                onCheck={(on) => setSel((s) => new Set(on ? [...s, t.name] : [...s].filter((n) => n !== t.name)))}
                onTrash={() => trash([t.name])}
                selected={selected === t.name}
                detail={selected === t.name ? detail : null}
              />
            ))}
          </ul>
        </div>
      )}
      {chosen.length > 0 && (
        <div
          role="region"
          aria-label="Selected tags"
          className="sticky bottom-3 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-popover px-4 py-2.5 shadow-md"
        >
          <p aria-live="polite" className="mr-auto text-sm font-medium tabular-nums">
            {chosen.length} selected
          </p>
          <Button variant="ghost" size="sm" className={TOUCH} disabled={pending} onClick={() => setSel(new Set())}>
            Clear
          </Button>
          <Confirm
            label="Move to Trash"
            question={`Pulls of ${chosen.length === 1 ? "this tag" : "these tags"} stop. ${chosen.length === 1 ? "It waits" : "They wait"} in Trash for 7 days.`}
            yes="Move to Trash"
            pending={pending}
            onYes={() => trash(chosen)}
          />
        </div>
      )}
    </section>
  )
}

function TagItem({
  t,
  x,
  scanOn,
  repo,
  host,
  writer,
  busy,
  same,
  checked,
  onCheck,
  onTrash,
  selected,
  detail,
}: {
  t: TagRow
  x: TagExtra | undefined
  scanOn: boolean
  repo: RepoDetail
  host: string
  writer: boolean
  busy: boolean
  same?: string
  checked: boolean
  onCheck: (on: boolean) => void
  onTrash: () => void
  selected: boolean
  detail: React.ReactNode
}) {
  const setNotice = useNotice()
  const router = useRouter()
  const image = `${host}/${repo.fullName}`
  const cell = "md:row-start-1"
  return (
    <li className={cn(selected && "bg-accent/30")}>
      <div className={cn("grid items-center gap-x-3 gap-y-1.5 px-4 py-3", writer ? GRID_WRITE : GRID_READ)}>
        {writer && (
          <label className={cn(BOX, cell, t.immutable && "cursor-not-allowed opacity-50")} title={t.immutable ? "Immutable tags can't be deleted" : undefined}>
            <input
              type="checkbox"
              aria-label={`Select ${t.name}`}
              checked={checked}
              disabled={t.immutable}
              onChange={(e) => onCheck(e.target.checked)}
              className="size-4 shrink-0 accent-primary"
            />
          </label>
        )}
        <div className={cn("grid min-w-0 gap-1", cell)}>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
            <Link
              href={selected ? `/registry/${repo.fullName}?tab=tags` : `/registry/${repo.fullName}?tab=tags&tag=${encodeURIComponent(t.name)}`}
              scroll={false}
              aria-expanded={selected}
              aria-controls={selected ? "detail" : undefined}
              className="inline-flex items-center gap-1 rounded-sm font-mono break-all underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:min-h-11"
            >
              <CaretDownIcon className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none", !selected && "-rotate-90")} />
              {t.name}
            </Link>
            {t.immutable && <Badge variant="secondary">Immutable</Badge>}
            {x?.signed && <Badge variant="outline">Signed</Badge>}
            {x?.sbom && <Badge variant="outline">SBOM</Badge>}
            {x?.attestation && <Badge variant="outline">Attestation</Badge>}
            <PolicyBadge v={x?.policy} />
          </p>
          {same && (
            <p className="text-xs text-muted-foreground">
              Same image as <span className="font-mono">{same}</span>
            </p>
          )}
        </div>
        <div className={cn("flex items-center justify-end gap-1 md:order-last", cell)}>
          <CopyButton value={`docker pull ${image}:${t.name}`} label={`Copy pull command for ${t.name}`} className={TOUCH} />
          <RowMenu label={`More for ${t.name}`}>
            <Menu.Item
              className={MENU_ITEM}
              onClick={() => navigator.clipboard.writeText(`docker pull ${image}@${t.digest}`).then(() => setNotice({ text: "Copied the pull command with the digest." }))}
            >
              <CopySimpleIcon />
              Copy digest pull command
            </Menu.Item>
            <Menu.Item className={MENU_ITEM} onClick={() => router.push(`/registry/${repo.fullName}?tab=tags&tag=${encodeURIComponent(t.name)}&view=compare#detail`)}>
              <GitDiffIcon />
              Compare with…
            </Menu.Item>
            {writer && (
              <Menu.Item className={cn(MENU_ITEM, "text-destructive [&_svg]:text-destructive data-disabled:opacity-50")} disabled={t.immutable || busy} onClick={onTrash}>
                <TrashIcon />
                {t.immutable ? "Immutable, can't delete" : "Move to Trash"}
              </Menu.Item>
            )}
          </RowMenu>
        </div>
        <div
          suppressHydrationWarning
          className={cn("col-span-full flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs text-muted-foreground md:contents", writer && "col-start-2")}
        >
          <span className={cn("min-w-0 truncate font-mono", cell)} title={t.platforms.join(", ") || undefined}>
            {t.platforms.length ? platformText(t.platforms) : <span aria-hidden className="max-md:hidden">—</span>}
          </span>
          <span className={cn("tabular-nums", cell)}>{sizeOf(t.bytes)}</span>
          <span className={cell}>{scanOn || x?.scan ? <SeverityCompact s={x?.scan} /> : null}</span>
          <span className={cell}>
            <span className="md:hidden">Pushed </span>
            {WHEN.format(new Date(t.pushedAt))}
            {t.pushedBy && <span className="md:block"> by {t.pushedBy}</span>}
          </span>
          <span
            className={cn("tabular-nums", cell)}
            title={t.lastPulledAt ? `Last pulled ${WHEN.format(new Date(t.lastPulledAt))}` : "Never pulled"}
          >
            {(x?.pulls ?? 0).toLocaleString()}
            <span className="md:hidden"> pulls (30d)</span>
          </span>
        </div>
      </div>
      {detail && <div className="border-t bg-background/40 px-4 py-4">{detail}</div>}
    </li>
  )
}
