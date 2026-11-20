"use client"

import { EyeIcon, FolderSimpleIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react"
import { useState, useTransition } from "react"

import { addWatch, removeWatch } from "@/app/(app)/more/convert/actions"
import { MoveDialog, type Place } from "@/components/move-dialog"
import { Empty, LIST, SELECT, TOUCH } from "@/components/registry-ui"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import type { PresetView, WatchView } from "@/lib/convert/jobs"
import { cn } from "@/lib/utils"
import { describe } from "./format"

// Folders whose new files are converted on arrival.
export function Watches({ watches, presets }: { watches: WatchView[]; presets: PresetView[] }) {
  const [adding, setAdding] = useState(false)
  const [picking, setPicking] = useState(false)
  const [folder, setFolder] = useState<Place | null>(null)
  const [preset, setPreset] = useState(presets[0]?.id ?? "")
  const [error, setError] = useState<string>()
  const [pending, run] = useTransition()

  const reset = () => {
    setAdding(false)
    setFolder(null)
    setError(undefined)
  }
  const add = () =>
    run(async () => {
      if (!folder) return setError("Choose a folder first.")
      if (!folder.id) return setError("Pick a folder inside My files, not My files itself.")
      const r = await addWatch(folder.id, preset).catch(() => ({ error: "Couldn't save. Check your connection and try again." }))
      if (r.error) setError(r.error)
      else reset()
    })

  return (
    <section aria-labelledby="convert-watches" className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="mr-auto grid gap-0.5">
          <h2 id="convert-watches" className="text-base font-semibold">Watch folders</h2>
          <p className="text-sm text-pretty text-muted-foreground">New files that land in a watched folder are converted on their own. Files already there and subfolders are left alone.</p>
        </div>
        {!adding && (
          <Button variant="outline" className={TOUCH} onClick={() => setAdding(true)}>
            <PlusIcon />
            Watch a folder
          </Button>
        )}
      </div>

      {adding && (
        <div className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">Folder</span>
            <Button variant="outline" className={cn(TOUCH, "justify-start")} onClick={() => setPicking(true)}>
              <FolderSimpleIcon />
              <span className="truncate">{folder?.name ?? "Choose a folder"}</span>
            </Button>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="watch-preset">Convert with</Label>
            <select id="watch-preset" value={preset} onChange={(e) => setPreset(e.target.value)} className={cn(SELECT, "pointer-coarse:h-11")}>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <Button className={TOUCH} disabled={pending} onClick={add}>{pending ? "Saving…" : "Watch"}</Button>
            <Button variant="outline" className={TOUCH} onClick={reset}>Cancel</Button>
          </div>
          {error && <p role="alert" className="text-sm text-pretty text-destructive sm:col-span-3">{error}</p>}
        </div>
      )}

      {watches.length === 0 ? (
        !adding && (
          <Empty icon={EyeIcon} title="No watched folders">
            <p>Watch a folder and everything uploaded to it is converted for you, like phone videos shrunk to 720p.</p>
          </Empty>
        )
      ) : (
        <ul className={LIST}>
          {watches.map((w) => (
            <li key={w.id} className="flex items-center gap-3 p-3">
              <FolderSimpleIcon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
              <div className="mr-auto min-w-0">
                <p className="truncate text-sm font-medium" title={w.path}>{w.path}</p>
                <p className="truncate text-sm text-muted-foreground">{w.presetName} · {describe(w.preset)}</p>
              </div>
              <Button variant="ghost" size="icon" className="pointer-coarse:size-11" aria-label={`Stop watching ${w.path}`} onClick={() => run(() => removeWatch(w.id))}>
                <TrashIcon />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <MoveDialog
        open={picking}
        title="Watch which folder?"
        moving={[]}
        start={[{ id: null, name: "My files" }]}
        action="Watch this folder"
        onClose={() => setPicking(false)}
        onMove={(to) => {
          setPicking(false)
          setFolder(to)
        }}
      />
    </section>
  )
}
