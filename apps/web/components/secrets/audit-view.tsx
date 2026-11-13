"use client"

import { useCallback, useEffect, useState } from "react"

import { api, errorText } from "@/components/secrets/client"
import type { Detail } from "@/components/secrets/project-view"
import { SELECT } from "@/components/secrets/ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Row = { id: string; at: string; actor: string; action: string; detail: string | null; target: string | null; env: string | null; ip: string | null; device: string | null }
type Result = { rows: Row[]; more: boolean; facets: { actors: { id: string; name: string }[]; actions: string[]; envs: string[] } }

const stamp = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "medium" })
const label = (a: string) => a.replace(/^secrets_/, "").replace(/_/g, " ")

// Every Secrets event in this project, for its admins.
export function AuditView({ detail }: { detail: Detail }) {
  const [f, setF] = useState({ actor: "", action: "", env: "", from: "", to: "" })
  const [rows, setRows] = useState<Row[] | null>(null)
  const [more, setMore] = useState(false)
  const [facets, setFacets] = useState<Result["facets"] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const qs = useCallback((before?: string) => new URLSearchParams({ ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), ...(before && { before }) }).toString(), [f])
  const load = useCallback(() => {
    api<Result>(`/projects/${detail.id}/audit?${qs()}`)
      .then((r) => (setRows(r.rows), setMore(r.more), setFacets(r.facets), setError(null)))
      .catch((e) => setError(errorText(e)))
  }, [detail.id, qs])
  useEffect(() => {
    load()
  }, [load])

  const field = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }))

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold tracking-tight">Audit</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className="grid gap-1.5">
          <Label htmlFor="au-actor">Person</Label>
          <select id="au-actor" className={SELECT} value={f.actor} onChange={(e) => field("actor", e.target.value)}>
            <option value="">Anyone</option>
            {facets?.actors.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="au-action">Action</Label>
          <select id="au-action" className={SELECT} value={f.action} onChange={(e) => field("action", e.target.value)}>
            <option value="">Any</option>
            {facets?.actions.map((a) => (
              <option key={a} value={a}>{label(a)}</option>
            ))}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="au-env">Environment</Label>
          <select id="au-env" className={SELECT} value={f.env} onChange={(e) => field("env", e.target.value)}>
            <option value="">Any</option>
            {facets?.envs.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="au-from">From</Label>
          <Input id="au-from" type="date" value={f.from} onChange={(e) => field("from", e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="au-to">To</Label>
          <Input id="au-to" type="date" value={f.to} onChange={(e) => field("to", e.target.value)} />
        </div>
      </div>
      <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
      {rows === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">No events match.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-176 border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/30 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Who</th>
                <th className="px-3 py-2 font-medium">What</th>
                <th className="px-3 py-2 font-medium">Where from</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b align-top last:border-0">
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground tabular-nums">{stamp.format(new Date(r.at))}</td>
                  <td className="px-3 py-2">{r.actor}</td>
                  <td className="px-3 py-2">
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{label(r.action)}</span>
                    {r.env && <span className="ml-1.5 text-xs text-muted-foreground">{r.env}</span>}
                    {(r.detail || r.target) && <p className="mt-1 text-pretty text-muted-foreground">{r.target ? `${r.target}: ` : ""}{r.detail}</p>}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {r.ip ?? "unknown IP"}
                    {r.device && <p>{r.device}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {more && rows && (
        <Button
          variant="outline"
          className="w-fit"
          onClick={async () => {
            const r = await api<Result>(`/projects/${detail.id}/audit?${qs(rows[rows.length - 1].at)}`).catch(() => null)
            if (r) {
              setRows([...rows, ...r.rows])
              setMore(r.more)
            }
          }}
        >
          Load older events
        </Button>
      )}
    </div>
  )
}
