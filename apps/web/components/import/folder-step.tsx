"use client"

import { CaretRightIcon, CircleNotchIcon, FolderSimpleIcon, WarningIcon } from "@phosphor-icons/react"
import { useEffect, useRef, useState } from "react"

import { freeSpace, remoteDirs, remoteSize } from "@/app/(app)/more/import/actions"
import { Button } from "@/components/ui/button"
import { TOUCH } from "@/components/registry-ui"
import { formatBytes } from "@/lib/file-rules"
import { cn } from "@/lib/utils"
import { count } from "./format"

type Dir = { name: string; path: string }
type Level = { state: "loading" } | { state: "error"; error: string } | { state: "ok"; dirs: Dir[] }
type Size = { count: number; bytes: number }
export type Picked = { paths: string[]; files: number; bytes: number; measuring: boolean }

// A lazy tree of the source's folders: open one to list it, tick the ones to bring over. The total under the ticked folders
// is measured with rclone and compared with the member's free space.
export function FolderStep({ connectionId, value, onChange, onMeasure }: { connectionId: string; value: string[]; onChange: (paths: string[]) => void; onMeasure: (total: Picked) => void }) {
  const [levels, setLevels] = useState<Record<string, Level>>({})
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [sizes, setSizes] = useState<Record<string, Size | "error">>({})
  const [free, setFree] = useState<number | null | undefined>()
  const asked = useRef(new Set<string>())

  const fetchLevel = (path: string) =>
    remoteDirs(connectionId, path).then(
      (r) => setLevels((l) => ({ ...l, [path]: "error" in r ? { state: "error", error: r.error } : { state: "ok", dirs: r } })),
      () => setLevels((l) => ({ ...l, [path]: { state: "error", error: "Couldn't reach the server. Try again." } }))
    )
  const load = (path: string) => {
    setLevels((l) => ({ ...l, [path]: { state: "loading" } }))
    void fetchLevel(path)
  }
  // The top level shows "Reading…" until this lands (no level yet), so nothing is set before the answer.
  useEffect(() => {
    void fetchLevel("")
    freeSpace().then(setFree, () => setFree(undefined))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId])

  // Measure each ticked folder once, one after another (a big folder takes a while).
  useEffect(() => {
    const todo = value.filter((p) => !(p in sizes) && !asked.current.has(p))
    if (!todo.length) return
    let live = true
    ;(async () => {
      for (const p of todo) {
        asked.current.add(p)
        const r = await remoteSize(connectionId, p).catch(() => ({ error: "x" }))
        if (!live) return void asked.current.delete(p)
        setSizes((s) => ({ ...s, [p]: "error" in r ? "error" : r }))
      }
    })()
    return () => {
      live = false
    }
  }, [value, sizes, connectionId])

  const measuring = value.some((p) => !(p in sizes))
  const total = value.reduce((t, p) => (typeof sizes[p] === "object" ? { files: t.files + (sizes[p] as Size).count, bytes: t.bytes + (sizes[p] as Size).bytes } : t), { files: 0, bytes: 0 })
  const failed = value.filter((p) => sizes[p] === "error")
  const over = free !== null && free !== undefined && total.bytes > free
  useEffect(() => {
    onMeasure({ paths: value, files: total.files, bytes: total.bytes, measuring })
  }, [value, total.files, total.bytes, measuring, onMeasure])

  const covered = (p: string) => value.some((v) => (v === "" ? p !== "" : p.startsWith(`${v}/`)))
  // A ticked folder swallows the ticked folders inside it.
  const toggle = (p: string) => onChange(value.includes(p) ? value.filter((v) => v !== p) : p === "" ? [""] : [...value.filter((v) => !v.startsWith(`${p}/`)), p])
  const expand = (p: string) => {
    setOpen((o) => {
      const n = new Set(o)
      if (n.has(p)) n.delete(p)
      else {
        n.add(p)
        if (!levels[p] || levels[p].state === "error") load(p)
      }
      return n
    })
  }

  const row = (name: string, p: string, depth: number) => {
    const ticked = value.includes(p)
    const inside = !ticked && covered(p)
    const lv = levels[p]
    return (
      <li key={p || "root"}>
        <div className="flex items-center gap-1 rounded-md px-1 hover:bg-accent/40" style={{ paddingLeft: `${depth * 1.25 + 0.25}rem` }}>
          <button type="button" aria-expanded={open.has(p)} aria-label={`${open.has(p) ? "Close" : "Open"} ${name}`} onClick={() => expand(p)} className="flex size-8 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:size-11">
            {lv?.state === "loading" && open.has(p) ? <CircleNotchIcon aria-hidden className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" /> : <CaretRightIcon aria-hidden className={cn("size-4 text-muted-foreground transition-transform motion-reduce:transition-none", open.has(p) && "rotate-90")} />}
          </button>
          <label className={cn("flex min-h-9 min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm pointer-coarse:min-h-11", inside && "cursor-default opacity-60")}>
            <input type="checkbox" className="size-4 shrink-0 accent-primary pointer-coarse:size-5" checked={ticked || inside} disabled={inside} onChange={() => toggle(p)} />
            <FolderSimpleIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate" title={name}>{name}</span>
            {ticked && sizes[p] === undefined && <span className="ml-auto text-xs text-muted-foreground">Measuring…</span>}
            {ticked && typeof sizes[p] === "object" && <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{count((sizes[p] as Size).count)} {(sizes[p] as Size).count === 1 ? "file" : "files"} · {formatBytes((sizes[p] as Size).bytes)}</span>}
            {ticked && sizes[p] === "error" && <span className="ml-auto text-xs text-destructive">Couldn&apos;t measure</span>}
          </label>
        </div>
        {open.has(p) && lv && (
          <ul>
            {lv.state === "loading" && <li className="py-1.5 text-sm text-muted-foreground" style={{ paddingLeft: `${(depth + 1) * 1.25 + 2}rem` }} role="status">Loading…</li>}
            {lv.state === "error" && (
              <li className="flex flex-wrap items-center gap-2 py-1.5 text-sm text-destructive" style={{ paddingLeft: `${(depth + 1) * 1.25 + 2}rem` }} role="alert">
                {lv.error}
                <Button type="button" variant="ghost" size="sm" onClick={() => load(p)}>Try again</Button>
              </li>
            )}
            {lv.state === "ok" && lv.dirs.length === 0 && <li className="py-1.5 text-sm text-muted-foreground" style={{ paddingLeft: `${(depth + 1) * 1.25 + 2}rem` }}>No folders inside. Its files come with it.</li>}
            {lv.state === "ok" && lv.dirs.map((d) => row(d.name, d.path, depth + 1))}
          </ul>
        )}
      </li>
    )
  }

  const top = levels[""]
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-prose text-sm text-pretty text-muted-foreground">Tick the folders to bring over. A ticked folder comes with everything inside it. Tick “Everything” to take the whole account.</p>
      <div className="rounded-xl border bg-background/40 p-1" role="group" aria-label="Folders at the source">
        {top?.state === "loading" || !top ? (
          <p role="status" className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground"><CircleNotchIcon aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />Reading your folders…</p>
        ) : top.state === "error" ? (
          <div role="alert" className="grid gap-2 px-3 py-6 text-sm">
            <p className="text-destructive">{top.error}</p>
            <Button type="button" variant="outline" className={`${TOUCH} w-fit`} onClick={() => load("")}>Try again</Button>
          </div>
        ) : (
          <ul className="max-h-96 overflow-auto">
            {row("Everything", "", 0)}
          </ul>
        )}
      </div>
      <div aria-live="polite" className="grid gap-2">
        <p className="text-sm tabular-nums">
          {value.length === 0 ? <span className="text-muted-foreground">Nothing ticked yet.</span> : <><b className="font-semibold">{count(total.files)}</b> {total.files === 1 ? "file" : "files"}, <b className="font-semibold">{formatBytes(total.bytes)}</b>{measuring ? <span className="text-muted-foreground"> · measuring…</span> : null}</>}
        </p>
        {failed.length > 0 && <p className="text-sm text-pretty text-muted-foreground">Couldn&apos;t measure {failed.length === 1 ? "one folder" : `${failed.length} folders`}. It still imports; the total is just short.</p>}
        {over && (
          <p role="alert" className="flex items-start gap-2 rounded-lg border border-warning/40 px-3 py-2.5 text-sm text-pretty">
            <WarningIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
            <span>This is {formatBytes(total.bytes - (free ?? 0))} more than the {formatBytes(free ?? 0)} you have free. The import stops when your storage is full. Tick fewer folders or free some space first.</span>
          </p>
        )}
      </div>
    </div>
  )
}
