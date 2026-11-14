"use client"

import { ArrowCounterClockwiseIcon, EyeIcon } from "@phosphor-icons/react"
import { useEffect, useState } from "react"

import { Comments } from "@/components/secrets/comments-thread"
import { api, errorText } from "@/components/secrets/client"
import { Confirm, Loading, Modal } from "@/components/secrets/ui"
import { useNotice } from "@/components/toaster"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type Version = { id: string; version: number; action: string; at: string; by: string | null; comment: string | null; type: string | null; valueChanged: boolean }
type History = { key: string; deleted: boolean; version: number; versions: Version[] }
type Values = { current: string; versions: { id: string; value: string }[] }

const stamp = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" })
const ACTION: Record<string, string> = {
  create: "Created",
  update: "Changed",
  delete: "Deleted",
  restore: "Restored",
  import: "Imported",
  rollback: "Rolled back",
  rotate: "Rotated",
}

// Lines only the old value has come first (removed), then the new value's lines.
function lineDiff(a: string, b: string) {
  const A = a.split("\n")
  const B = b.split("\n")
  return [
    ...A.filter((l) => !B.includes(l)).map((text) => ({ text, kind: "removed" as const })),
    ...B.map((text) => ({ text, kind: A.includes(text) ? ("same" as const) : ("added" as const) })),
  ]
}

// Every version of one secret: who changed it and when, a compare against the
// current value (revealing is logged), and restore.
export function HistoryDialog({
  projectId,
  secretId,
  keyName,
  canWrite,
  admin,
  onClose,
  onChanged,
}: {
  projectId: string
  secretId: string
  keyName: string
  canWrite: boolean
  admin: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const notify = useNotice()
  const [h, setH] = useState<History | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pick, setPick] = useState<string | null>(null)
  const [values, setValues] = useState<Values | null>(null)
  const [restore, setRestore] = useState<Version | null>(null)

  useEffect(() => {
    api<History>(`/projects/${projectId}/history?secretId=${secretId}`)
      .then(setH)
      .catch((e) => setError(errorText(e)))
  }, [projectId, secretId])

  async function compare(v: Version) {
    setPick(v.id)
    setValues(null)
  }
  async function reveal() {
    if (!pick) return
    try {
      setValues(await api<Values>(`/projects/${projectId}/history`, "POST", { action: "reveal", secretId, ids: [pick] }))
    } catch (e) {
      setError(errorText(e))
    }
  }
  const picked = h?.versions.find((v) => v.id === pick)
  const old = values?.versions.find((v) => v.id === pick)?.value

  return (
    <Modal title={`History of ${keyName}`} description={h ? `${h.versions.length} version${h.versions.length === 1 ? "" : "s"}. Values stay hidden until you reveal them, and revealing is logged.` : undefined} wide onClose={onClose}>
      <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
      {!h ? (
        <Loading />
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {h.versions.map((v, i) => (
            <li key={v.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm", pick === v.id && "bg-muted/40")}>
              <span className="w-9 font-mono text-xs text-muted-foreground">v{v.version}</span>
              <span className="font-medium">{ACTION[v.action] ?? v.action}</span>
              <span className="text-muted-foreground">
                {v.by ?? "a token"} · {stamp.format(new Date(v.at))}
              </span>
              {v.valueChanged && v.action !== "create" && <span className="rounded bg-brand/10 px-1.5 py-0.5 text-xs text-brand">value changed</span>}
              {i === 0 && <span className="rounded bg-muted px-1.5 py-0.5 text-xs">latest</span>}
              <span className="ml-auto flex gap-1">
                {i > 0 && (
                  <Button variant="ghost" size="sm" aria-label={`Compare version ${v.version} with the current value`} onClick={() => compare(v)}>
                    <EyeIcon />
                    Compare
                  </Button>
                )}
                {canWrite && i > 0 && !h.deleted && v.action !== "delete" && (
                  <Button variant="ghost" size="sm" aria-label={`Restore version ${v.version}`} onClick={() => setRestore(v)}>
                    <ArrowCounterClockwiseIcon />
                    Restore
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {picked && (
        <div className="grid gap-2 rounded-lg border p-3" aria-label="Comparison">
          <p className="text-sm font-medium">Version {picked.version} against the current value</p>
          {values && old !== undefined ? (
            <pre className="max-h-56 overflow-auto rounded-md bg-muted/30 p-2 font-mono text-sm break-all whitespace-pre-wrap">
              {lineDiff(old, values.current).map((l, i) => (
                <span key={i} className={cn("block px-1", l.kind === "removed" && "bg-destructive/15 text-destructive", l.kind === "added" && "bg-brand/15")}>
                  {l.kind === "removed" ? "− " : l.kind === "added" ? "+ " : "  "}
                  {l.text}
                </span>
              ))}
            </pre>
          ) : (
            <Button variant="outline" className="w-fit" onClick={reveal}>
              <EyeIcon />
              Reveal both values
            </Button>
          )}
        </div>
      )}
      <Comments projectId={projectId} target={{ secretId }} admin={admin} />
      {restore && (
        <Confirm
          title={`Restore version ${restore.version}?`}
          description="This writes that version's value as a new version. Nothing is erased from the history."
          action="Restore"
          run={async () => {
            const r = await api<{ request?: { id: string } }>(`/projects/${projectId}/history`, "POST", { action: "restore", secretId, versionId: restore.id })
            notify({ text: r.request ? "Sent for review in Change requests." : `Restored version ${restore.version}.` })
            onChanged()
            setH(await api<History>(`/projects/${projectId}/history?secretId=${secretId}`))
            setValues(null)
          }}
          onClose={() => setRestore(null)}
        />
      )}
    </Modal>
  )
}
