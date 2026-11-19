"use client"

import { ArrowLeftIcon, FileIcon, FolderIcon } from "@phosphor-icons/react"
import { useEffect, useState } from "react"

import { file, tree } from "@/app/(app)/more/github-backup/actions"
import { CODE, LIST, SELECT, TOUCH } from "@/components/registry-ui"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { formatBytes } from "@/lib/file-rules"
import type { TreeEntry } from "@/lib/gitbackup/runner"
import { cn } from "@/lib/utils"

type Tree = { refs: string[]; ref: string; entries: TreeEntry[] }
type File = { size: number; binary: boolean; text: string | null }
const MAX_SHOWN = 200_000

// Looks inside a snapshot without restoring it: a ref switcher, folders to open and a file viewer. Inline, not a modal.
export function Browse({ snapshotId, title, onClose }: { snapshotId: string; title: string; onClose: () => void }) {
  const [ref, setRef] = useState<string>()
  const [path, setPath] = useState("")
  const [t, setT] = useState<Tree | null>(null)
  const [open, setOpen] = useState<{ path: string; f: File } | null>(null)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(true)

  useEffect(() => {
    let live = true
    tree(snapshotId, { ref, path }).then(
      (r) => {
        if (!live) return
        if ("error" in r) setError(r.error)
        else setT(r)
        setBusy(false)
      },
      () => live && (setError("Couldn't open this snapshot. Try again."), setBusy(false))
    )
    return () => {
      live = false
    }
  }, [snapshotId, ref, path])

  const crumbs = path ? path.split("/") : []
  const load = () => (setBusy(true), setError(undefined))
  const go = (p: string) => (load(), setOpen(null), setPath(p))
  const show = (e: TreeEntry) => {
    if (e.type === "tree") return go(e.path)
    setError(undefined)
    file(snapshotId, { ref: t?.ref, path: e.path }).then((r) => ("error" in r ? setError(r.error) : setOpen({ path: e.path, f: r })), () => setError("Couldn't read that file."))
  }
  const sorted = [...(t?.entries ?? [])].sort((a, b) => (a.type === b.type ? a.path.localeCompare(b.path) : a.type === "tree" ? -1 : 1))

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" className={TOUCH} onClick={onClose}>
          <ArrowLeftIcon />
          Back
        </Button>
        <p className="min-w-0 flex-1 truncate text-sm font-semibold" title={title}>{title}</p>
        {t && t.refs.length > 1 && (
          <div className="flex items-center gap-2">
            <Label htmlFor="browse-ref" className="text-muted-foreground">Branch or tag</Label>
            <select id="browse-ref" value={t.ref} onChange={(e) => (load(), setOpen(null), setPath(""), setRef(e.target.value))} className={cn(SELECT, "max-w-52 font-mono pointer-coarse:h-11")}>
              {t.refs.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      <nav aria-label="Path" className="flex flex-wrap items-center gap-1 font-mono text-xs text-muted-foreground">
        <button type="button" className="rounded-sm underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50" onClick={() => go("")}>
          root
        </button>
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-1">
            /
            <button type="button" className="rounded-sm underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50" onClick={() => go(crumbs.slice(0, i + 1).join("/"))}>
              {c}
            </button>
          </span>
        ))}
      </nav>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {open ? (
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="min-w-0 truncate font-mono" title={open.path}>{open.path}</span>
            <span className="flex items-center gap-2">
              <span className="tabular-nums text-muted-foreground">{formatBytes(open.f.size)}</span>
              <Button variant="ghost" size="sm" className={TOUCH} onClick={() => setOpen(null)}>Close file</Button>
            </span>
          </div>
          {open.f.binary || open.f.text === null ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">This is a binary file, so there is no preview. Restore the snapshot to get it.</p>
          ) : (
            <pre className={cn(CODE, "max-h-[28rem]")} tabIndex={0}>{open.f.text.length > MAX_SHOWN ? `${open.f.text.slice(0, MAX_SHOWN)}\n… cut off` : open.f.text}</pre>
          )}
        </div>
      ) : busy && !t ? (
        <div aria-busy="true" className="grid gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-9 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Nothing here.</p>
      ) : (
        <ul className={cn(LIST, busy && "opacity-60")}>
          {sorted.map((e) => (
            <li key={e.path}>
              <button type="button" onClick={() => show(e)} className="flex min-h-10 w-full items-center gap-3 px-3 py-2 text-left text-sm outline-none hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset">
                {e.type === "tree" ? <FolderIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" /> : <FileIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
                <span className="min-w-0 flex-1 truncate font-mono text-xs" title={e.path}>{e.path.split("/").pop()}</span>
                {e.size !== null && <span className="tabular-nums text-xs text-muted-foreground">{formatBytes(e.size)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
