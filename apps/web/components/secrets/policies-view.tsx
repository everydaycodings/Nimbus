"use client"

import { ShieldCheckIcon, TrashIcon } from "@phosphor-icons/react"
import { useState } from "react"

import { useLoad } from "@/components/secrets/access-view"
import { api, errorText } from "@/components/secrets/client"
import type { Detail } from "@/components/secrets/project-view"
import { CHECKBOX, SELECT } from "@/components/secrets/ui"
import { SubmitButton } from "@/components/submit-button"
import { useNotice } from "@/components/toaster"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Member = { userId: string; name: string; role: string }
type Required = { key: string; kind: "any" | "url" | "int" | "regex"; pattern: string | null }

// Which environments need review before they change, and the keys every
// environment must have (with the shape their values must take).
export function PoliciesView({ detail, onChanged }: { detail: Detail; onChanged: () => void }) {
  const { data: members } = useLoad<{ members: Member[] }>(`/projects/${detail.id}/members`)
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4" aria-label="Protected environments">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold tracking-tight">Protected environments</h2>
          <p className="max-w-prose text-sm text-pretty text-muted-foreground">
            A protected environment doesn&apos;t take edits directly. Saves, imports, bulk actions, rollbacks and read-write tokens become change requests that approvers must approve first.
          </p>
        </div>
        <ul className="flex flex-col divide-y rounded-xl border">
          {detail.envs.map((e) => (
            <EnvPolicy key={`${e.id}:${e.protected}:${e.approvalsRequired}:${e.adminBypass}:${e.approverIds?.join()}`} detail={detail} env={e} members={members?.members ?? []} onChanged={onChanged} />
          ))}
        </ul>
      </section>
      <RequiredKeys detail={detail} />
    </div>
  )
}

function EnvPolicy({ detail, env, members, onChanged }: { detail: Detail; env: Detail["envs"][number]; members: Member[]; onChanged: () => void }) {
  const notify = useNotice()
  const [on, setOn] = useState(env.protected)
  const [n, setN] = useState(env.approvalsRequired)
  const [chosen, setChosen] = useState<string[]>(env.approverIds ?? [])
  const [bypass, setBypass] = useState(env.adminBypass)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = on !== env.protected || n !== env.approvalsRequired || bypass !== env.adminBypass || chosen.join() !== (env.approverIds ?? []).join()

  return (
    <li className="grid gap-3 px-4 py-4">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" className={CHECKBOX} checked={on} onChange={(e) => setOn(e.target.checked)} aria-label={`Protect ${env.name}`} />
        {env.name}
        {env.protected && <ShieldCheckIcon className="size-4 text-brand" weight="fill" aria-label="Protected" />}
      </label>
      {on && (
        <div className="grid gap-4 pl-6">
          <div className="grid gap-2 sm:max-w-48">
            <Label htmlFor={`n-${env.id}`}>Approvals needed</Label>
            <select id={`n-${env.id}`} className={SELECT} value={n} onChange={(e) => setN(Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">Who can approve</legend>
            <p className="text-xs text-muted-foreground">Pick people, or leave all unticked to let any project admin approve. Nobody approves their own request.</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {members.map((m) => (
                <label key={m.userId} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className={CHECKBOX}
                    checked={chosen.includes(m.userId)}
                    onChange={(e) => setChosen((c) => (e.target.checked ? [...c, m.userId] : c.filter((x) => x !== m.userId)))}
                  />
                  {m.name} <span className="text-xs text-muted-foreground">{m.role}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className={CHECKBOX} checked={bypass} onChange={(e) => setBypass(e.target.checked)} />
            Project admins can bypass review (logged as a bypass)
          </label>
        </div>
      )}
      <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
      {dirty && (
        <div className="flex gap-2 pl-6">
          <SubmitButton
            type="button"
            pending={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await api(`/projects/${detail.id}/envs/${env.id}`, "PATCH", { policy: { protected: on, approvalsRequired: n, approverIds: chosen.length ? chosen : null, adminBypass: bypass } })
                notify({ text: on ? `${env.name} is protected.` : `${env.name} is no longer protected.` })
                onChanged()
              } catch (e) {
                setError(errorText(e))
              } finally {
                setBusy(false)
              }
            }}
          >
            Save
          </SubmitButton>
          <Button variant="outline" onClick={() => (setOn(env.protected), setN(env.approvalsRequired), setChosen(env.approverIds ?? []), setBypass(env.adminBypass), setError(null))}>Discard</Button>
        </div>
      )}
    </li>
  )
}

function RequiredKeys({ detail }: { detail: Detail }) {
  const { data, error, reload } = useLoad<{ keys: Required[] }>(`/projects/${detail.id}/required`)
  const [key, setKey] = useState("")
  const [kind, setKind] = useState<Required["kind"]>("any")
  const [pattern, setPattern] = useState("")
  const [err, setErr] = useState<string | null>(null)
  return (
    <section className="flex flex-col gap-4" aria-label="Required keys">
      <div className="grid gap-1">
        <h2 className="text-lg font-semibold tracking-tight">Required keys</h2>
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">
          Keys every environment must have. The Overview flags environments that miss one, and a save that breaks a key&apos;s format is refused.
        </p>
      </div>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={async (e) => {
          e.preventDefault()
          try {
            await api(`/projects/${detail.id}/required`, "PUT", { key, kind, pattern: kind === "regex" ? pattern : null })
            setKey("")
            setPattern("")
            setErr(null)
            await reload()
            window.dispatchEvent(new Event("secrets-changed"))
          } catch (e2) {
            setErr(errorText(e2))
          }
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="rk-key">Key</Label>
          <Input id="rk-key" value={key} onChange={(e) => setKey(e.target.value)} placeholder="DATABASE_URL" className="w-52 font-mono" spellCheck={false} autoCapitalize="off" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="rk-kind">Value must be</Label>
          <select id="rk-kind" className={`${SELECT} w-44`} value={kind} onChange={(e) => setKind(e.target.value as Required["kind"])}>
            <option value="any">Anything</option>
            <option value="url">A URL</option>
            <option value="int">A whole number</option>
            <option value="regex">Matching a pattern</option>
          </select>
        </div>
        {kind === "regex" && (
          <div className="grid gap-1.5">
            <Label htmlFor="rk-pattern">Pattern</Label>
            <Input id="rk-pattern" value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="^sk_(live|test)_" className="w-52 font-mono" spellCheck={false} />
          </div>
        )}
        <Button type="submit" disabled={!key.trim()}>Require key</Button>
      </form>
      <p role="alert" className="text-sm text-destructive empty:hidden">{err ?? error}</p>
      {data && data.keys.length > 0 && (
        <ul className="flex flex-col divide-y rounded-xl border">
          {data.keys.map((k) => (
            <li key={k.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
              <span className="font-mono">{k.key}</span>
              <span className="text-xs text-muted-foreground">{k.kind === "any" ? "any value" : k.kind === "regex" ? `matches ${k.pattern}` : k.kind === "url" ? "a URL" : "a whole number"}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                className="ml-auto"
                aria-label={`Stop requiring ${k.key}`}
                onClick={async () => {
                  await api(`/projects/${detail.id}/required?key=${encodeURIComponent(k.key)}`, "DELETE").catch((e) => setErr(errorText(e)))
                  await reload()
                  window.dispatchEvent(new Event("secrets-changed"))
                }}
              >
                <TrashIcon />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
