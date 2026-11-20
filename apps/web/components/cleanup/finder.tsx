"use client"

import { TrashIcon } from "@phosphor-icons/react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import { trashItems } from "@/app/(app)/file-actions"
import { Thumb } from "@/components/thumb"
import { previewKind } from "@/lib/file-rules"
import { useNotice } from "@/components/toaster"
import { Button } from "@/components/ui/button"
import { SELECT, TOUCH } from "@/components/registry-ui"
import { ago } from "@/lib/health-rules"
import { fileType, formatBytes } from "@/lib/file-types"
import type { Item } from "@/lib/files"
import type { FinderFile, FinderGroup } from "@/lib/cleanup/finder"
import { cn } from "@/lib/utils"
import { TABS, type Tab } from "./tabs"

const BASE = "/more/cleanup"
const LIST = "flex flex-col divide-y rounded-xl border bg-card"
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`
const MONTHS = [3, 6, 12, 24, 36]
const SIZES = [1, 10, 100, 500, 1000] // MB

// A Thumb wants a files-list Item; it only reads these.
const TEXT = new Set(["text", "markdown", "csv"])
// Text files' thumbnails are near-empty dark tiles, so they get the type icon instead.
const asItem = (f: FinderFile) => ({ id: f.id, name: f.name, mime: f.mime, version: f.version, thumb: TEXT.has(previewKind(f.mime, f.name) ?? "") ? null : f.thumb }) as Item

export function Finder({
  tab,
  groups,
  files,
  months,
  minMb,
  indexing,
  hasSimilar,
  now,
}: {
  tab: Tab
  groups: FinderGroup[] // duplicates and similar photos
  files: FinderFile[] // largest and not opened
  months: number
  minMb: number
  indexing: number
  hasSimilar: boolean
  now: number
}) {
  const router = useRouter()
  const setNotice = useNotice()
  const [pending, start] = useTransition()
  const grouped = tab === "duplicates" || tab === "similar"
  // Every copy but the oldest (the first of a group) starts ticked.
  const [ticked, setTicked] = useState(() => new Set(grouped ? groups.flatMap((g) => g.files.slice(1).map((f) => f.id)) : []))

  const all = grouped ? groups.flatMap((g) => g.files) : files
  const picked = all.filter((f) => ticked.has(f.id))
  const bytes = picked.reduce((n, f) => n + f.size, 0)
  const nothingKept = grouped ? groups.filter((g) => g.files.every((f) => ticked.has(f.id))).length : 0
  const freeable = grouped ? groups.reduce((n, g) => n + (g.files.length - 1) * g.files[0].size, 0) : 0

  const toggle = (id: string) =>
    setTicked((s) => {
      const n = new Set(s)
      if (!n.delete(id)) n.add(id)
      return n
    })

  // The one to keep: ticks the other copies in its group, unticks this one.
  const keep = (g: FinderGroup, id: string) =>
    setTicked((s) => {
      const n = new Set(s)
      for (const f of g.files) {
        if (f.id === id) n.delete(f.id)
        else n.add(f.id)
      }
      return n
    })

  const trash = () =>
    start(async () => {
      const ids = picked.map((f) => f.id)
      const r = await trashItems(ids).catch(() => ({ error: "Something went wrong. Try again." }))
      if (r.error) return setNotice({ text: r.error, error: true })
      setNotice({ text: `Moved ${plural(ids.length, "file")} to the trash.` })
      setTicked(new Set())
      router.refresh()
    })

  const href = (t: Tab) => (t === "duplicates" ? BASE : `${BASE}?tab=${t}`)

  return (
    <div className="flex flex-col gap-5">
      <nav role="tablist" aria-label="Clean up sections" className="flex w-fit max-w-full overflow-x-auto rounded-lg bg-muted p-[3px]">
        {TABS.filter(([t]) => t !== "similar" || hasSimilar).map(([t, text]) => (
          <Link
            key={t}
            href={href(t)}
            role="tab"
            aria-selected={tab === t}
            aria-current={tab === t ? "page" : undefined}
            className="flex h-7 items-center rounded-md border border-transparent px-3 text-sm whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:h-11 aria-[current=page]:border-input aria-[current=page]:bg-input/30 aria-[current=page]:text-foreground"
          >
            {text}
          </Link>
        ))}
      </nav>

      {indexing > 0 && (
        <p role="status" className="rounded-xl border bg-card px-3 py-2.5 text-sm text-pretty text-muted-foreground">
          Indexing {plural(indexing, "file")}… Files that aren&apos;t read yet can&apos;t be matched as duplicates. Check back in a few minutes.
        </p>
      )}

      {tab === "largest" && (
        <Filter id="min" label="Bigger than" value={minMb} to={(v) => `${BASE}?tab=largest&min=${v}`}>
          {SIZES.map((m) => (
            <option key={m} value={m}>{m >= 1000 ? "1 GB" : `${m} MB`}</option>
          ))}
        </Filter>
      )}
      {tab === "unopened" && (
        <Filter id="months" label="Not opened for" value={months} to={(v) => `${BASE}?tab=unopened&months=${v}`}>
          {MONTHS.map((m) => (
            <option key={m} value={m}>{m >= 12 ? plural(m / 12, "year") : `${m} months`}</option>
          ))}
        </Filter>
      )}

      {all.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-12 text-center text-sm text-pretty text-muted-foreground">{EMPTY[tab]}</p>
      ) : (
        <>
          <div className="sticky top-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-card px-4 py-3">
            <p className="mr-auto text-sm text-pretty tabular-nums">
              {grouped && (
                <span className="font-medium">{formatBytes(freeable)} can be freed</span>
              )}
              {grouped && <span className="text-muted-foreground"> from {plural(groups.length, "group")}. </span>}
              <span className="text-muted-foreground">{picked.length ? `${plural(picked.length, "file")} selected, ${formatBytes(bytes)}.` : "Nothing selected."}</span>
            </p>
            {!grouped && picked.length < all.length && (
              <Button variant="ghost" className={TOUCH} onClick={() => setTicked(new Set(all.map((f) => f.id)))}>Select all</Button>
            )}
            {picked.length > 0 && !grouped && (
              <Button variant="ghost" className={TOUCH} onClick={() => setTicked(new Set())}>Clear</Button>
            )}
            <Button variant="destructive" className={TOUCH} disabled={pending || picked.length === 0 || nothingKept > 0} onClick={trash}>
              <TrashIcon />
              Move {picked.length || ""} to Trash
            </Button>
            {nothingKept > 0 && (
              <p role="alert" className="w-full text-sm text-pretty text-destructive">
                {plural(nothingKept, "group")} would lose every copy. Untick one copy in each to keep it.
              </p>
            )}
          </div>

          {grouped ? (
            <ul className="flex flex-col gap-4">
              {groups.map((g) => (
                <li key={g.key}>
                  <section aria-label={`${g.files[0].name} and ${g.files.length - 1} more`}>
                    <h2 className="mb-1.5 text-sm text-muted-foreground tabular-nums">
                      {g.files.length} copies · {formatBytes(g.files[0].size)} each
                    </h2>
                    <ul className={LIST}>
                      {g.files.map((f, i) => (
                        <Row key={f.id} f={f} on={ticked.has(f.id)} toggle={() => toggle(f.id)} detail={`${i === 0 ? "Oldest · " : ""}${f.where || "My files"} · added ${ago(f.createdAt, now)}`}>
                          {ticked.has(f.id) && g.files.some((o) => !ticked.has(o.id)) && (
                            <Button variant="ghost" size="sm" className={TOUCH} onClick={() => keep(g, f.id)}>Keep this one</Button>
                          )}
                        </Row>
                      ))}
                    </ul>
                  </section>
                </li>
              ))}
            </ul>
          ) : (
            <ul className={LIST}>
              {files.map((f) => (
                <Row key={f.id} f={f} on={ticked.has(f.id)} toggle={() => toggle(f.id)} detail={`${f.where || "My files"} · ${tab === "unopened" ? (f.openedAt ? `last opened ${ago(f.openedAt, now)}` : "never opened") : `added ${ago(f.createdAt, now)}`}`} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

const EMPTY: Record<Tab, string> = {
  duplicates: "No duplicates. No two of your files have the same contents.",
  similar: "No similar photos found.",
  largest: "No files this big. Pick a smaller size to see more.",
  unopened: "Nothing here. Every file was opened or added recently.",
}

function Filter({ id, label, value, to, children }: { id: string; label: string; value: number; to: (v: string) => string; children: React.ReactNode }) {
  const router = useRouter()
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-sm text-muted-foreground">{label}</label>
      <select id={id} value={value} onChange={(e) => router.push(to(e.target.value))} className={cn(SELECT, "pointer-coarse:h-11")}>
        {children}
      </select>
    </div>
  )
}

function Row({ f, on, toggle, detail, children }: { f: FinderFile; on: boolean; toggle: () => void; detail: string; children?: React.ReactNode }) {
  const t = fileType("file", f.mime, f.name)
  return (
    <li className="flex min-h-file-row flex-wrap items-center gap-x-3 gap-y-1 py-2 pr-2 pl-3 sm:flex-nowrap">
      <input type="checkbox" checked={on} onChange={toggle} aria-label={`Select ${f.name}`} className="size-4 pointer-coarse:size-6 shrink-0 accent-primary" />
      <Thumb item={asItem(f)} make={false} className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
        <t.icon className={cn("size-5", t.color)} />
      </Thumb>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Link href={f.parentId ? `/folders/${f.parentId}` : "/"} className="w-fit max-w-full truncate rounded-sm text-sm underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50" title={f.name}>
          {f.name}
        </Link>
        <span className="truncate text-xs text-muted-foreground" title={detail}>{detail}</span>
      </span>
      {/* Narrow screens: the name takes the first line, the button and size the second. */}
      <div className={cn("flex items-center justify-between gap-3 sm:contents", children ? "w-full pl-[3.25rem]" : "contents")}>
        {children}
        <span className="ml-auto w-20 shrink-0 text-right text-sm text-muted-foreground tabular-nums">{formatBytes(f.size)}</span>
      </div>
    </li>
  )
}
