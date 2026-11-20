"use client"

import { CheckCircleIcon, FileZipIcon, MagnifyingGlassIcon, PlusIcon, WarningCircleIcon } from "@phosphor-icons/react"
import { useRouter } from "next/navigation"
import { useEffect, useId, useState } from "react"

import { zips } from "@/app/(app)/more/import/actions"
import { RADIO, RADIO_INPUT, TOUCH } from "@/components/registry-ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatBytes } from "@/lib/file-rules"
import type { ConnView } from "@/lib/import/connections"
import type { ZipPick } from "@/lib/import/jobs"
import { AddConnection, type Ready } from "./add-connection"
import { label, ProviderIcon } from "./providers"

export type Source = { kind: "cloud"; connectionId: string } | { kind: "takeout" }

// Step 1: a saved connection, a new one, or Google Takeout zips already in Files.
export function SourceStep({ connections, oauth, value, onChange, zipIds, onZips }: { connections: ConnView[]; oauth: Ready; value: Source | null; onChange: (s: Source) => void; zipIds: string[]; onZips: (ids: string[]) => void }) {
  const id = useId()
  const router = useRouter()
  const [adding, setAdding] = useState(connections.length === 0)
  return (
    <div className="flex flex-col gap-4">
      {connections.length > 0 && (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">Use a connection</legend>
          {connections.map((c) => (
            <label key={c.id} className={RADIO}>
              <input type="radio" name={`${id}-src`} className={RADIO_INPUT} checked={value?.kind === "cloud" && value.connectionId === c.id} onChange={() => onChange({ kind: "cloud", connectionId: c.id })} />
              <ProviderIcon provider={c.provider} />
              <span className="min-w-0 flex-1 truncate" title={c.label}>
                {c.label}
                <span className="text-muted-foreground"> · {label(c.provider)}{c.account ? ` · ${c.account}` : ""}</span>
              </span>
              {c.error ? <WarningCircleIcon aria-label="Needs attention" className="size-4 shrink-0 text-destructive" /> : <CheckCircleIcon aria-hidden className="size-4 shrink-0 text-brand" />}
            </label>
          ))}
        </fieldset>
      )}
      {adding ? (
        <AddConnection oauth={oauth} onAdded={(cid) => (setAdding(false), onChange({ kind: "cloud", connectionId: cid }), router.refresh())} onCancel={connections.length ? () => setAdding(false) : undefined} />
      ) : (
        <Button type="button" variant="outline" className={`${TOUCH} w-fit`} onClick={() => setAdding(true)}>
          <PlusIcon />
          Add a connection
        </Button>
      )}
      <fieldset className="grid gap-2">
        {connections.length === 0 && <legend className="mb-1 text-sm font-medium">Or use zips you already have</legend>}
        <label className={RADIO}>
          <input type="radio" name={`${id}-src`} className={RADIO_INPUT} checked={value?.kind === "takeout"} onChange={() => onChange({ kind: "takeout" })} />
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted"><FileZipIcon aria-hidden className="size-5 text-muted-foreground" /></span>
          <span className="min-w-0 flex-1">
            Google Takeout zips
            <span className="block text-muted-foreground">Already in your Files. Photos get the date they were taken.</span>
          </span>
        </label>
      </fieldset>
      {value?.kind === "takeout" && <ZipPicker value={zipIds} onChange={onZips} />}
    </div>
  )
}

function ZipPicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const id = useId()
  const [q, setQ] = useState("")
  const [rows, setRows] = useState<ZipPick[] | null>(null)
  useEffect(() => {
    let live = true
    const t = setTimeout(() => zips(q).then((r) => live && setRows(r), () => live && setRows([])), q ? 250 : 0)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [q])
  return (
    <div className="grid gap-2 rounded-xl border bg-background/40 p-3">
      <div className="relative">
        <MagnifyingGlassIcon aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input aria-label="Search your zip files" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your zip files" className="pl-9 pointer-coarse:h-11" />
      </div>
      {rows === null ? (
        <p role="status" className="px-1 py-4 text-sm text-muted-foreground">Looking for zips…</p>
      ) : rows.length === 0 ? (
        <p className="px-1 py-4 text-sm text-pretty text-muted-foreground">{q ? "No zip matches." : "No zip files in your Files yet. Upload your Takeout zips first, then come back."}</p>
      ) : (
        <ul className="max-h-72 divide-y overflow-auto rounded-lg border">
          {rows.map((z) => (
            <li key={z.id}>
              <label htmlFor={`${id}-${z.id}`} className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-accent/40">
                <input id={`${id}-${z.id}`} type="checkbox" className="size-4 shrink-0 accent-primary pointer-coarse:size-5" checked={value.includes(z.id)} onChange={(e) => onChange(e.target.checked ? [...value, z.id] : value.filter((v) => v !== z.id))} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate" title={z.name}>{z.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{z.where}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatBytes(z.size)}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-muted-foreground tabular-nums">{value.length} zip{value.length === 1 ? "" : "s"} picked</p>
    </div>
  )
}
