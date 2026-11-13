"use client"

import { CheckCircleIcon, EyeIcon, GitPullRequestIcon, MinusCircleIcon, PlusCircleIcon, PencilSimpleIcon, WarningIcon, XCircleIcon } from "@phosphor-icons/react"
import { useCallback, useEffect, useState } from "react"

import { api, errorText } from "@/components/secrets/client"
import { Comments } from "@/components/secrets/comments-thread"
import type { Detail } from "@/components/secrets/project-view"
import { Confirm } from "@/components/secrets/ui"
import { useNotice } from "@/components/toaster"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type Item = { id: string; env: string; author: string; source: string; status: string; count: number; keys: string[]; approvals: number; required: number; createdAt: string }
type Entry = { index: number; key: string; folder: string; kind: "add" | "change" | "delete"; fields: string[]; conflict: string | null; gone: boolean }
type Full = {
  id: string
  env: { id: string; name: string; slug: string }
  author: string
  mine: boolean
  source: string
  status: "open" | "merged" | "rejected" | "closed"
  createdAt: string
  resolvedAt: string | null
  required: number
  approvers: { id: string; name: string }[]
  reviews: { userId: string; name: string; decision: "approve" | "reject"; at: string }[]
  state: "pending" | "approved" | "rejected"
  entries: Entry[]
  conflicts: string[]
  canReview: boolean
  canMerge: boolean
  canClose: boolean
}

const stamp = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" })
const SOURCE: Record<string, string> = { save: "an edit", import: "an import", bulk: "a bulk action", rollback: "a rollback", restore: "a restored version" }
const KIND = {
  add: { label: "Add", icon: PlusCircleIcon, tone: "text-brand" },
  change: { label: "Change", icon: PencilSimpleIcon, tone: "text-warning" },
  delete: { label: "Delete", icon: MinusCircleIcon, tone: "text-destructive" },
} as const

// Edits to protected environments wait here: a diff of key adds, changes and
// deletes, a thread, Approve or Reject, and Merge once approved.
export function RequestsView({ detail, initial }: { detail: Detail; initial: string | null }) {
  const [open, setOpen] = useState<string | null>(initial)
  const [all, setAll] = useState(false)
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(
    () =>
      api<{ requests: Item[] }>(`/projects/${detail.id}/requests?status=${all ? "all" : "open"}`)
        .then((r) => (setItems(r.requests), setError(null)))
        .catch((e) => setError(errorText(e))),
    [detail.id, all]
  )
  useEffect(() => {
    load()
  }, [load])

  if (open) return <RequestDetail detail={detail} id={open} onBack={() => (setOpen(null), load())} />

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Change requests</h2>
        <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" className="size-4 accent-primary" checked={all} onChange={(e) => setAll(e.target.checked)} />
          Show closed ones
        </label>
      </div>
      <p className="max-w-prose text-sm text-pretty text-muted-foreground">
        Protected environments don&apos;t take edits directly. Every save, import, bulk action, rollback and API write becomes a request here until enough approvers say yes.
      </p>
      <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
      {items === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-14 text-center">
          <GitPullRequestIcon className="size-6 text-muted-foreground" />
          <p className="font-medium">{all ? "No change requests yet" : "Nothing waiting for review"}</p>
          <p className="max-w-sm text-sm text-pretty text-muted-foreground">
            {detail.role === "admin" ? "Protect an environment under Policies to start requiring review." : "Edits to protected environments will show up here."}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border">
          {items.map((r) => (
            <li key={r.id}>
              <button onClick={() => setOpen(r.id)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left outline-none hover:bg-muted/40 focus-visible:bg-muted/40">
                <span className="font-medium">{r.env}</span>
                <span className="text-sm text-muted-foreground">
                  {r.author} · {r.count} change{r.count === 1 ? "" : "s"} · {stamp.format(new Date(r.createdAt))}
                </span>
                <span className="font-mono text-xs text-muted-foreground">{r.keys.join(", ")}{r.count > r.keys.length ? "…" : ""}</span>
                <span className={cn("ml-auto rounded px-1.5 py-0.5 text-xs", r.status === "open" ? "bg-warning/10 text-warning" : r.status === "merged" ? "bg-brand/10 text-brand" : "bg-muted text-muted-foreground")}>
                  {r.status === "open" ? `${r.approvals}/${r.required} approved` : r.status}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function RequestDetail({ detail, id, onBack }: { detail: Detail; id: string; onBack: () => void }) {
  const notify = useNotice()
  const base = `/projects/${detail.id}/requests/${id}`
  const [r, setR] = useState<Full | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [shown, setShown] = useState<Record<number, { old: string | null; new: string | null }>>({})
  const [confirm, setConfirm] = useState<"close" | null>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(
    () =>
      api<Full>(base)
        .then((d) => (setR(d), setError(null)))
        .catch((e) => setError(errorText(e))),
    [base]
  )
  useEffect(() => {
    load()
  }, [load])

  async function act(action: "approve" | "reject" | "merge") {
    setBusy(true)
    try {
      await api(base, "POST", { action })
      notify({ text: action === "merge" ? "Merged. The changes are live." : action === "approve" ? "Approved." : "Rejected." })
      await load()
      if (action === "merge") window.dispatchEvent(new Event("secrets-changed"))
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  async function reveal(i: number) {
    try {
      setShown((s) => ({ ...s, [i]: { old: null, new: null } }))
      const v = await api<{ old: string | null; new: string | null }>(base, "POST", { action: "reveal", index: i })
      setShown((s) => ({ ...s, [i]: v }))
    } catch (e) {
      setError(errorText(e))
    }
  }

  if (!r) return error ? <p role="alert" className="text-sm text-destructive">{error}</p> : <p className="text-sm text-muted-foreground">Loading…</p>
  const need = Math.max(0, r.required - r.reviews.filter((v) => v.decision === "approve").length)

  return (
    <div className="flex flex-col gap-5">
      <Button variant="ghost" size="sm" className="w-fit" onClick={onBack}>
        Back to requests
      </Button>
      <div className="grid gap-1">
        <h2 className="text-lg font-semibold tracking-tight">
          {r.author} wants to change {r.env.name}
        </h2>
        <p className="text-sm text-muted-foreground">
          By {SOURCE[r.source] ?? r.source}, {stamp.format(new Date(r.createdAt))}.{" "}
          <span className="font-medium text-foreground">{r.status === "open" ? (r.state === "approved" ? "Approved, ready to merge" : r.state === "rejected" ? "Rejected" : `Needs ${need} more approval${need === 1 ? "" : "s"}`) : r.status[0].toUpperCase() + r.status.slice(1)}</span>
        </p>
      </div>
      {r.conflicts.length > 0 && r.status === "open" && (
        <div role="alert" className="flex gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <WarningIcon className="mt-0.5 size-4 shrink-0 text-warning" />
          <div className="grid gap-1">
            <p className="font-medium">Out of date: these changed after the request was made, so it can&apos;t merge.</p>
            <ul className="list-disc pl-4 text-muted-foreground">{r.conflicts.map((c) => <li key={c}>{c}</li>)}</ul>
            <p className="text-muted-foreground">Close it and make the edit again.</p>
          </div>
        </div>
      )}
      <ul className="flex flex-col divide-y rounded-xl border" aria-label="Changes">
        {r.entries.map((e) => {
          const K = KIND[e.kind]
          const v = shown[e.index]
          return (
            <li key={e.index} className="grid gap-2 px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className={cn("flex items-center gap-1 text-xs font-medium", K.tone)}>
                  <K.icon className="size-4" />
                  {K.label}
                </span>
                <span className="font-mono text-sm">{e.key}</span>
                {e.folder && <span className="text-xs text-muted-foreground">in {e.folder}</span>}
                {e.fields.length > 0 && <span className="text-xs text-muted-foreground">{e.fields.join(", ")}</span>}
                {e.gone && <span className="text-xs text-muted-foreground">already gone</span>}
                {e.conflict && <span className="text-xs text-destructive">{e.conflict}</span>}
                {e.kind !== "delete" && !v && (
                  <Button variant="ghost" size="xs" className="ml-auto" aria-label={`Reveal the values of ${e.key}`} onClick={() => reveal(e.index)}>
                    <EyeIcon />
                    Reveal
                  </Button>
                )}
              </div>
              {v && (
                <div className="grid gap-1 font-mono text-xs sm:grid-cols-2">
                  <pre className="overflow-auto rounded-md bg-destructive/10 px-2 py-1 break-all whitespace-pre-wrap">{v.old === null ? "(none)" : `− ${v.old}`}</pre>
                  <pre className="overflow-auto rounded-md bg-brand/10 px-2 py-1 break-all whitespace-pre-wrap">{v.new === null ? "(value unchanged)" : `+ ${v.new}`}</pre>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <section aria-label="Reviews" className="grid gap-2">
        <h3 className="text-sm font-medium">Approvers</h3>
        <p className="text-sm text-muted-foreground">
          {r.required} approval{r.required === 1 ? "" : "s"} needed from {r.approvers.map((a) => a.name).join(", ") || "project admins"}.
        </p>
        <ul className="grid gap-1">
          {r.reviews.map((v) => (
            <li key={v.userId} className="flex items-center gap-2 text-sm">
              {v.decision === "approve" ? <CheckCircleIcon className="size-4 text-brand" weight="fill" /> : <XCircleIcon className="size-4 text-destructive" weight="fill" />}
              {v.name} {v.decision === "approve" ? "approved" : "rejected"} · {stamp.format(new Date(v.at))}
            </li>
          ))}
        </ul>
      </section>
      <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
      {r.status === "open" && (
        <div className="flex flex-wrap gap-2">
          {r.canReview && (
            <>
              <Button disabled={busy} onClick={() => act("approve")}>Approve</Button>
              <Button variant="outline" disabled={busy} onClick={() => act("reject")}>Reject</Button>
            </>
          )}
          {r.canMerge && (
            <Button disabled={busy || r.conflicts.length > 0} onClick={() => act("merge")}>
              Merge
            </Button>
          )}
          {r.canClose && (
            <Button variant="ghost" className="ml-auto" onClick={() => setConfirm("close")}>
              Close request
            </Button>
          )}
        </div>
      )}
      <Comments projectId={detail.id} target={{ requestId: id }} admin={detail.role === "admin"} />
      {confirm === "close" && (
        <Confirm
          title="Close this request?"
          description="Nothing is applied. You can make the edit again."
          action="Close request"
          run={async () => {
            await api(base, "POST", { action: "close" })
            await load()
          }}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  )
}
