"use client"

import { HourglassMediumIcon } from "@phosphor-icons/react"
import { useState } from "react"

import { useLoad } from "@/components/secrets/access-view"
import { api, errorText } from "@/components/secrets/client"
import type { Detail } from "@/components/secrets/project-view"
import { Empty } from "@/components/secrets/pki-ui"
import { Loading, Modal, SELECT } from "@/components/secrets/ui"
import { SubmitButton } from "@/components/submit-button"
import { useNotice } from "@/components/toaster"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

type Req = { id: string; who: string; env: string; role: string; minutes: number; reason: string; status: string; expiresAt: string | null; createdAt: string; mine: boolean }
type Askable = { id: string; name: string; canView: boolean; canWrite: boolean }

const stamp = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" })
const DURATIONS = [
  [60, "1 hour"],
  [240, "4 hours"],
  [1440, "1 day"],
] as const
const long = (m: number) => (m % 1440 === 0 ? `${m / 1440} day${m === 1440 ? "" : "s"}` : m % 60 === 0 ? `${m / 60} hour${m === 60 ? "" : "s"}` : `${m} min`)
const TONE: Record<string, string> = { pending: "bg-warning/10 text-warning", approved: "bg-brand/10 text-brand", denied: "bg-destructive/10 text-destructive" }

// A member asks for an environment for a while; a project admin answers. The
// grant ends by itself: the server stops counting it at its expiry.
export function AccessRequestsView({ detail }: { detail: Detail }) {
  const notify = useNotice()
  const admin = detail.role === "admin"
  const { data, error, reload } = useLoad<{ requests: Req[]; envs: Askable[] }>(`/projects/${detail.id}/access-requests`)
  const [asking, setAsking] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function decide(id: string, action: "approve" | "deny" | "revoke") {
    try {
      await api(`/projects/${detail.id}/access-requests`, "POST", { action, id })
      notify({ text: action === "approve" ? "Approved." : action === "deny" ? "Denied." : "Access ended." })
      await reload()
      window.dispatchEvent(new Event("secrets-changed"))
    } catch (e) {
      setErr(errorText(e))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Access requests</h2>
        {!admin && (
          <Button className="ml-auto" onClick={() => setAsking(true)} disabled={!data?.envs.some((e) => e.canView || e.canWrite)}>
            <HourglassMediumIcon />
            Request access
          </Button>
        )}
      </div>
      <p className="max-w-prose text-sm text-pretty text-muted-foreground">
        {admin
          ? "Members can ask for an environment for an hour, a few, or a day. When you approve, the clock starts and access ends on its own."
          : "Need an environment you can't open, or write access to one you can only read? Ask for a set time and say why."}
      </p>
      <p role="alert" className="text-sm text-destructive empty:hidden">{error ?? err}</p>
      {!data ? (
        <Loading />
      ) : data.requests.length === 0 ? (
        <Empty icon={<HourglassMediumIcon />} title="No requests yet">
          {admin ? "Requests from members show up here for you to answer." : "Your requests and their answers show up here."}
        </Empty>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border">
          {data.requests.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
              <span className="font-medium">{r.mine ? "You" : r.who}</span>
              <span>
                {r.role === "developer" ? "edit" : "read"} {r.env} for {long(r.minutes)}
              </span>
              <span className="basis-full text-xs text-muted-foreground sm:basis-auto">“{r.reason}”</span>
              <span className="ml-auto flex items-center gap-2">
                <span className={cn("rounded px-1.5 py-0.5 text-xs", TONE[r.status] ?? "bg-muted text-muted-foreground")}>
                  {r.status === "approved" && r.expiresAt ? `until ${stamp.format(new Date(r.expiresAt))}` : r.status}
                </span>
                {admin && r.status === "pending" && !r.mine && (
                  <>
                    <Button size="sm" onClick={() => decide(r.id, "approve")}>Approve</Button>
                    <Button size="sm" variant="outline" onClick={() => decide(r.id, "deny")}>Deny</Button>
                  </>
                )}
                {admin && r.status === "approved" && (
                  <Button size="sm" variant="ghost" onClick={() => decide(r.id, "revoke")}>End now</Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {asking && data && (
        <AskDialog
          detail={detail}
          envs={data.envs}
          onClose={() => setAsking(false)}
          onDone={() => {
            setAsking(false)
            notify({ text: "Sent. An admin will answer." })
            reload()
          }}
        />
      )}
    </div>
  )
}

function AskDialog({ detail, envs, onClose, onDone }: { detail: Detail; envs: Askable[]; onClose: () => void; onDone: () => void }) {
  const usable = envs.filter((e) => e.canView || e.canWrite)
  const [envId, setEnvId] = useState(usable[0]?.id ?? "")
  const here = usable.find((e) => e.id === envId)
  const [role, setRole] = useState<"viewer" | "developer">("viewer")
  const [minutes, setMinutes] = useState<number>(60)
  const [custom, setCustom] = useState(false)
  const [hours, setHours] = useState("2")
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The roles offered for this environment: view only if they can't see it yet.
  const roleOk = (r: "viewer" | "developer") => (r === "viewer" ? here?.canView : here?.canWrite)
  const effective = roleOk(role) ? role : roleOk("developer") ? "developer" : "viewer"

  return (
    <Modal title="Request temporary access" description="An admin approves it. Access ends on its own when the time is up." onClose={onClose}>
      <form
        className="grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          try {
            await api(`/projects/${detail.id}/access-requests`, "POST", {
              action: "create",
              envId,
              role: effective,
              minutes: custom ? Math.round(Number(hours) * 60) : minutes,
              reason,
            })
            onDone()
          } catch (err) {
            setError(errorText(err))
            setBusy(false)
          }
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="ask-env">Environment</Label>
            <select id="ask-env" className={SELECT} value={envId} onChange={(e) => setEnvId(e.target.value)}>
              {usable.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ask-role">Role</Label>
            <select id="ask-role" className={SELECT} value={effective} onChange={(e) => setRole(e.target.value as "viewer" | "developer")}>
              {here?.canView && <option value="viewer">Read</option>}
              {here?.canWrite && <option value="developer">Read and edit</option>}
            </select>
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="ask-for">For how long</Label>
          <select
            id="ask-for"
            className={SELECT}
            value={custom ? "custom" : minutes}
            onChange={(e) => (e.target.value === "custom" ? setCustom(true) : (setCustom(false), setMinutes(Number(e.target.value))))}
          >
            {DURATIONS.map(([m, l]) => (
              <option key={m} value={m}>{l}</option>
            ))}
            <option value="custom">Custom…</option>
          </select>
          {custom && (
            <div className="flex items-center gap-2">
              <Input aria-label="Hours" type="number" min={0.25} max={720} step={0.25} value={hours} onChange={(e) => setHours(e.target.value)} className="w-28" />
              <span className="text-sm text-muted-foreground">hours</span>
            </div>
          )}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="ask-why">Why do you need it?</Label>
          <Input id="ask-why" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required />
        </div>
        <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <SubmitButton pending={busy} disabled={!envId || !reason.trim()}>Send request</SubmitButton>
        </div>
      </form>
    </Modal>
  )
}
