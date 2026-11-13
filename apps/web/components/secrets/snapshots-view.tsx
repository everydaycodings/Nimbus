"use client"

import { ClockCounterClockwiseIcon } from "@phosphor-icons/react"
import { useCallback, useEffect, useState } from "react"

import { api, errorText } from "@/components/secrets/client"
import type { Detail } from "@/components/secrets/project-view"
import { Confirm, Modal, SELECT } from "@/components/secrets/ui"
import { useNotice } from "@/components/toaster"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

type Moment = { at: string; by: string; counts: Record<string, number>; keys: string[]; more: number }
type Step = { kind: "add" | "change" | "delete"; key: string; folder: string; fields: string[] }

const stamp = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "medium" })
const WORD: Record<string, string> = { create: "added", update: "changed", delete: "deleted", restore: "restored", import: "imported", rollback: "rolled back" }
const summary = (c: Record<string, number>) =>
  Object.entries(c).map(([k, n]) => `${n} ${WORD[k] ?? k}`).join(", ")

// A timeline of changes per environment; pick a moment, preview what a rollback
// changes, then apply it as new versions (history is never rewritten).
export function SnapshotsView({ detail }: { detail: Detail }) {
  const notify = useNotice()
  const [envId, setEnvId] = useState(detail.envs[0]?.id ?? "")
  const [folderId, setFolderId] = useState("")
  const [moments, setMoments] = useState<Moment[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ at: string; steps: Step[]; protected: boolean } | null>(null)
  const [applying, setApplying] = useState(false)
  const env = detail.envs.find((e) => e.id === envId)
  const folders = detail.folders.filter((f) => f.envId === envId)
  const writable = detail.writableEnvs.includes(envId)

  const load = useCallback(() => {
    if (!envId) return
    setMoments(null)
    api<{ moments: Moment[] }>(`/projects/${detail.id}/timeline?envId=${envId}${folderId ? `&folderId=${folderId}` : ""}`)
      .then((r) => (setMoments(r.moments), setError(null)))
      .catch((e) => setError(errorText(e)))
  }, [detail.id, envId, folderId])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads when the scope changes
    load()
  }, [load])

  async function open(at: string) {
    try {
      const r = await api<{ steps: Step[]; protected: boolean }>(`/projects/${detail.id}/rollback`, "POST", { envId, folderId: folderId || null, at })
      setPreview({ at, ...r })
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold tracking-tight">Snapshots</h2>
      <p className="max-w-prose text-sm text-pretty text-muted-foreground">
        Every change is kept. Pick a moment to see what rolling back to it would change. Applying it writes new versions on top, so nothing is lost
        {env?.protected ? "; this environment is protected, so it goes through a change request" : ""}.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="snap-env">Environment</Label>
          <select id="snap-env" className={cn(SELECT, "w-44")} value={envId} onChange={(e) => (setEnvId(e.target.value), setFolderId(""))}>
            {detail.envs.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="snap-folder">Folder</Label>
          <select id="snap-folder" className={cn(SELECT, "w-52")} value={folderId} onChange={(e) => setFolderId(e.target.value)}>
            <option value="">Whole environment</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>{f.path}</option>
            ))}
          </select>
        </div>
      </div>
      <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
      {moments === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : moments.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-14 text-center">
          <ClockCounterClockwiseIcon className="size-6 text-muted-foreground" />
          <p className="font-medium">No changes here yet</p>
        </div>
      ) : (
        <ol className="flex flex-col divide-y rounded-xl border" aria-label="Timeline">
          {moments.map((m, i) => (
            <li key={m.at} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
              <span className="w-44 shrink-0 text-muted-foreground tabular-nums">{stamp.format(new Date(m.at))}</span>
              <span className="font-medium">{m.by}</span>
              <span>{summary(m.counts)}</span>
              <span className="font-mono text-xs text-muted-foreground">{m.keys.join(", ")}{m.more ? ` and ${m.more} more` : ""}</span>
              <span className="ml-auto">
                {i === 0 ? (
                  <span className="text-xs text-muted-foreground">Current</span>
                ) : (
                  <Button variant="outline" size="sm" aria-label={`Preview going back to ${stamp.format(new Date(m.at))}`} onClick={() => open(m.at)}>
                    <ClockCounterClockwiseIcon />
                    Go back to here
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
      {preview && (
        <Modal title="Roll back to this moment?" description={`${env?.name}${folderId ? ` / ${folders.find((f) => f.id === folderId)?.path}` : ""} as of ${stamp.format(new Date(preview.at))}.`} wide onClose={() => setPreview(null)}>
          {preview.steps.length === 0 ? (
            <p className="text-sm text-muted-foreground">It already matches that moment. Nothing would change.</p>
          ) : (
            <ul className="max-h-72 divide-y overflow-auto rounded-lg border" aria-label="What would change">
              {preview.steps.map((s, i) => (
                <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                  <span className={cn("w-16 text-xs font-medium", s.kind === "add" ? "text-brand" : s.kind === "delete" ? "text-destructive" : "text-warning")}>
                    {s.kind === "add" ? "Bring back" : s.kind === "delete" ? "Remove" : "Revert"}
                  </span>
                  <span className="font-mono">{s.key}</span>
                  {s.folder && <span className="text-xs text-muted-foreground">in {s.folder}</span>}
                  {s.fields.length > 0 && <span className="text-xs text-muted-foreground">{s.fields.join(", ")}</span>}
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPreview(null)}>Cancel</Button>
            <Button
              disabled={!preview.steps.length || !writable}
              title={writable ? undefined : "You can't change this environment"}
              onClick={() => setApplying(true)}
            >
              {preview.protected ? "Send for review" : "Apply rollback"}
            </Button>
          </div>
        </Modal>
      )}
      {applying && preview && (
        <Confirm
          title={preview.protected ? "Send the rollback for review?" : "Apply the rollback?"}
          description={`${preview.steps.length} secret${preview.steps.length === 1 ? "" : "s"} will change${preview.protected ? " once it's approved and merged" : " now"}. The history keeps everything.`}
          action={preview.protected ? "Send for review" : "Apply rollback"}
          run={async () => {
            const r = await api<{ request?: { id: string } }>(`/projects/${detail.id}/rollback`, "POST", { envId, folderId: folderId || null, at: preview.at, apply: true })
            notify({ text: r.request ? "Sent for review in Change requests." : "Rolled back." })
            setPreview(null)
            load()
            window.dispatchEvent(new Event("secrets-changed"))
          }}
          onClose={() => setApplying(false)}
        />
      )}
    </div>
  )
}
