"use client"

import { KeyIcon, PlusIcon, TrashIcon, UserPlusIcon } from "@phosphor-icons/react"
import { useCallback, useEffect, useState } from "react"

import { api, copySecret, errorText } from "@/components/secrets/client"
import { IntegrationsView } from "@/components/secrets/integrations-view"
import { Empty } from "@/components/secrets/pki-ui"
import type { Detail } from "@/components/secrets/project-view"
import { CHECKBOX, Confirm, Modal, SELECT } from "@/components/secrets/ui"
import { SubmitButton } from "@/components/submit-button"
import { Button } from "@/components/ui/button"
import { GuideLink } from "@/components/secrets/guide-link"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

type Tab = "members" | "tokens" | "push" | "webhooks"
const TABS: [Tab, string][] = [
  ["members", "Members"],
  ["tokens", "Machine tokens"],
  ["push", "Server push"],
  ["webhooks", "Webhooks"],
]

export function useLoad<T>(path: string) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(
    () =>
      api<T>(path)
        .then((d) => (setData(d), setError(null)))
        .catch((e) => setError(errorText(e))),
    [path]
  )
  useEffect(() => {
    load()
  }, [load])
  return { data, error, reload: load }
}

// Who can open the project, what machines can read it, and where changes go.
export function AccessView({ detail, initialTab }: { detail: Detail; initialTab?: "tokens" }) {
  const [tab, setTab] = useState<Tab>(initialTab ?? "members")
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold tracking-tight">Access</h2>
      <div role="tablist" aria-label="Access" className="flex gap-1 overflow-x-auto border-b">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              "-mb-px h-9 shrink-0 border-b-2 px-3 text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
              tab === id
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "members" && <Members detail={detail} />}
      {tab === "tokens" && <Tokens detail={detail} />}
      {(tab === "push" || tab === "webhooks") && <IntegrationsView detail={detail} kind={tab} />}
    </div>
  )
}

export function EnvPicker({
  envs,
  value,
  onChange,
  allLabel = "All environments",
}: {
  envs: Detail["envs"]
  value: string[] | null
  onChange: (v: string[] | null) => void
  allLabel?: string
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium">Environments</legend>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className={CHECKBOX} checked={value === null} onChange={(e) => onChange(e.target.checked ? null : [])} />
        {allLabel}
      </label>
      {value !== null && (
        <div className="flex flex-wrap gap-x-4 gap-y-2 pl-6">
          {envs.map((e) => (
            <label key={e.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className={CHECKBOX}
                checked={value.includes(e.id)}
                onChange={(ev) => onChange(ev.target.checked ? [...value, e.id] : value.filter((x) => x !== e.id))}
              />
              {e.name}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  )
}

// ---- Members ----------------------------------------------------------------

type Member = { userId: string; name: string; email: string; role: "admin" | "developer" | "viewer"; envIds: string[] | null }
const ROLE_HINT = {
  admin: "Everything, in every environment: members, tokens, settings.",
  developer: "Read and change secrets in the environments chosen.",
  viewer: "Read secrets in the environments chosen. No changes.",
}

function Members({ detail }: { detail: Detail }) {
  const { data, error, reload } = useLoad<{ members: Member[] }>(`/projects/${detail.id}/members`)
  const [edit, setEdit] = useState<Member | "new" | null>(null)
  const [drop, setDrop] = useState<Member | null>(null)
  const envName = (id: string) => detail.envs.find((e) => e.id === id)?.name
  return (
    <section className="flex flex-col gap-3" aria-label="Members">
      <div className="flex flex-wrap items-center gap-3">
        <p className="max-w-prose flex-1 basis-72 text-sm text-pretty text-muted-foreground">
          Only people with a Nimbus account can join. Give a developer or viewer just the environments they need, say everything except Production.
        </p>
        <Button onClick={() => setEdit("new")}>
          <UserPlusIcon />
          Add member
        </Button>
      </div>
      <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
      <ul className="flex flex-col divide-y rounded-xl border">
        {data?.members.map((m) => (
          <li key={m.userId} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
            <div className="min-w-0 flex-1 basis-48">
              <p className="truncate text-sm font-medium">{m.name}</p>
              <p className="truncate text-xs text-muted-foreground">{m.email}</p>
            </div>
            <span className="w-24 text-sm capitalize">{m.role}</span>
            <span className="min-w-0 flex-1 basis-40 truncate text-sm text-muted-foreground">
              {m.envIds === null ? "All environments" : m.envIds.map(envName).filter(Boolean).join(", ") || "No environments"}
            </span>
            <Button variant="outline" size="sm" onClick={() => setEdit(m)} aria-label={`Change ${m.name}`}>
              Change
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label={`Remove ${m.name}`} onClick={() => setDrop(m)}>
              <TrashIcon />
            </Button>
          </li>
        ))}
      </ul>
      {edit && (
        <MemberDialog
          detail={detail}
          member={edit === "new" ? null : edit}
          onClose={() => setEdit(null)}
          onSaved={reload}
        />
      )}
      {drop && (
        <Confirm
          title={`Remove ${drop.name}?`}
          description="They lose access to this project at once. Their personal overrides stay but can't be seen by anyone."
          action="Remove"
          danger
          run={async () => {
            await api(`/projects/${detail.id}/members/${drop.userId}`, "DELETE")
            reload()
          }}
          onClose={() => setDrop(null)}
        />
      )}
    </section>
  )
}

function MemberDialog({
  detail,
  member,
  onClose,
  onSaved,
}: {
  detail: Detail
  member: Member | null
  onClose: () => void
  onSaved: () => void
}) {
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<Member["role"]>(member?.role ?? "developer")
  const [envs, setEnvs] = useState<string[] | null>(member ? member.envIds : null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <Modal title={member ? `Change ${member.name}` : "Add a member"} onClose={onClose}>
      <form
        className="grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          try {
            const body = { role, envIds: role === "admin" ? null : envs }
            if (member) await api(`/projects/${detail.id}/members/${member.userId}`, "PATCH", body)
            else await api(`/projects/${detail.id}/members`, "POST", { ...body, email })
            onSaved()
            onClose()
          } catch (err) {
            setError(errorText(err))
            setBusy(false)
          }
        }}
      >
        {!member && (
          <div className="grid gap-2">
            <Label htmlFor="member-email">Their Nimbus email</Label>
            <Input id="member-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </div>
        )}
        <div className="grid gap-2">
          <Label htmlFor="member-role">Role</Label>
          <select id="member-role" className={SELECT} value={role} onChange={(e) => setRole(e.target.value as Member["role"])}>
            <option value="admin">Admin</option>
            <option value="developer">Developer</option>
            <option value="viewer">Viewer</option>
          </select>
          <p className="text-xs text-muted-foreground">{ROLE_HINT[role]}</p>
        </div>
        {role !== "admin" && <EnvPicker envs={detail.envs} value={envs} onChange={setEnvs} />}
        <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <SubmitButton pending={busy}>{member ? "Save" : "Add member"}</SubmitButton>
        </div>
      </form>
    </Modal>
  )
}

// ---- Machine tokens ---------------------------------------------------------

type Token = {
  id: string
  name: string
  prefix: string
  envIds: string[]
  path: string
  access: "ro" | "rw"
  expiresAt: string | null
  ipAllow: string[]
  scopes?: string[]
  createdBy: string | null
  lastUsedAt: string | null
  lastIp: string | null
  revoked: boolean
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })

function Tokens({ detail }: { detail: Detail }) {
  const { data, error, reload } = useLoad<{ tokens: Token[] }>(`/projects/${detail.id}/tokens`)
  const [making, setMaking] = useState(false)
  const [shown, setShown] = useState<{ name: string; token: string } | null>(null)
  const [drop, setDrop] = useState<Token | null>(null)
  const envName = (id: string) => detail.envs.find((e) => e.id === id)?.name
  return (
    <section className="flex flex-col gap-3" aria-label="Machine tokens">
      <div className="flex flex-wrap items-center gap-3">
        <p className="max-w-prose flex-1 basis-72 text-sm text-pretty text-muted-foreground">
          For servers, CI and scripts: <code className="font-mono">NIMBUS_TOKEN=nms_…</code> with the CLI or the REST API. A token sees only the environments and folder you choose, and never needs the unlock. <GuideLink to="machine-tokens">Using tokens in your apps</GuideLink>
        </p>
        <Button onClick={() => setMaking(true)}>
          <PlusIcon />
          New token
        </Button>
      </div>
      <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
      {data && !data.tokens.length && (
        <Empty icon={<KeyIcon />} title="No tokens yet">
          <GuideLink to="cli">See how servers and CI use them</GuideLink>
        </Empty>
      )}
      <ul className="flex flex-col divide-y rounded-xl border empty:hidden">
        {data?.tokens.map((t) => {
          const expired = t.expiresAt && new Date(t.expiresAt) < new Date()
          return (
            <li key={t.id} className={cn("flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3", (t.revoked || expired) && "opacity-60")}>
              <KeyIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1 basis-56">
                <p className="truncate text-sm font-medium">
                  {t.name}{" "}
                  <span className="font-mono text-xs font-normal text-muted-foreground">{t.prefix}…</span>
                </p>
                <p className="text-xs text-pretty text-muted-foreground">
                  {t.access === "rw" ? "Read and write" : "Read only"} · {t.envIds.map(envName).filter(Boolean).join(", ")} · /{t.path}
                  {t.ipAllow.length > 0 && ` · from ${t.ipAllow.join(", ")}`}
                  {t.scopes && t.scopes.length > 0 && ` · KMS: ${t.scopes.map((x) => x.replace("kms:", "")).join(", ")}`}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t.revoked ? "Revoked" : expired ? "Expired" : t.expiresAt ? `Expires ${when(t.expiresAt)}` : "Never expires"} ·{" "}
                  {t.lastUsedAt ? `Last used ${when(t.lastUsedAt)}${t.lastIp ? ` from ${t.lastIp}` : ""}` : "Never used"}
                </p>
              </div>
              {!t.revoked && (
                <Button variant="outline" size="sm" onClick={() => setDrop(t)} aria-label={`Revoke ${t.name}`}>
                  Revoke
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      {making && <TokenDialog detail={detail} onClose={() => setMaking(false)} onMade={(name, token) => (setShown({ name, token }), reload())} />}
      {shown && (
        <Modal title="Copy your token now" description={`“${shown.name}” is shown once. Nimbus keeps only a hash, so a lost token can't be recovered: revoke it and make another.`} onClose={() => setShown(null)}>
          <code className="block rounded-md border bg-muted px-3 py-2 font-mono text-sm break-all" data-testid="new-token">{shown.token}</code>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => copySecret(shown.token)}>Copy</Button>
            <Button onClick={() => setShown(null)}>Done</Button>
          </div>
        </Modal>
      )}
      {drop && (
        <Confirm
          title={`Revoke ${drop.name}?`}
          description="Anything using this token stops working at once."
          action="Revoke token"
          danger
          run={async () => {
            await api(`/projects/${detail.id}/tokens/${drop.id}`, "DELETE")
            reload()
          }}
          onClose={() => setDrop(null)}
        />
      )}
    </section>
  )
}

function TokenDialog({ detail, onClose, onMade }: { detail: Detail; onClose: () => void; onMade: (name: string, token: string) => void }) {
  const [name, setName] = useState("")
  const [envs, setEnvs] = useState<string[]>([])
  const [path, setPath] = useState("/")
  const [access, setAccess] = useState<"ro" | "rw">("ro")
  const [days, setDays] = useState("90")
  const [ips, setIps] = useState("")
  const [scopes, setScopes] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <Modal title="New machine token" onClose={onClose}>
      <form
        className="grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          try {
            const r = await api<{ token: string }>(`/projects/${detail.id}/tokens`, "POST", {
              name,
              envIds: envs,
              path,
              access,
              expiresInDays: days === "never" ? null : Number(days),
              ipAllow: ips.split(/[\s,]+/).filter(Boolean),
              scopes,
            })
            onMade(name, r.token)
            onClose()
          } catch (err) {
            setError(errorText(err))
            setBusy(false)
          }
        }}
      >
        <GuideLink to="machine-tokens">What each setting does</GuideLink>
        <div className="grid gap-2">
          <Label htmlFor="token-name">Name</Label>
          <Input id="token-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. prod web server" maxLength={60} required autoFocus />
        </div>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">Environments</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {detail.envs.map((e) => (
              <label key={e.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className={CHECKBOX}
                  checked={envs.includes(e.id)}
                  onChange={(ev) => setEnvs(ev.target.checked ? [...envs, e.id] : envs.filter((x) => x !== e.id))}
                />
                {e.name}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="token-path">Folder</Label>
            <Input id="token-path" value={path} onChange={(e) => setPath(e.target.value)} className="font-mono" />
            <p className="text-xs text-muted-foreground">/ is everything, /app only that folder and below.</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="token-access">Access</Label>
            <select id="token-access" className={SELECT} value={access} onChange={(e) => setAccess(e.target.value as "ro" | "rw")}>
              <option value="ro">Read only</option>
              <option value="rw">Read and write</option>
            </select>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="token-expiry">Expires</Label>
            <select id="token-expiry" className={SELECT} value={days} onChange={(e) => setDays(e.target.value)}>
              <option value="7">In 7 days</option>
              <option value="30">In 30 days</option>
              <option value="90">In 90 days</option>
              <option value="365">In a year</option>
              <option value="never">Never</option>
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="token-ips">Allowed IPs (optional)</Label>
            <Input id="token-ips" value={ips} onChange={(e) => setIps(e.target.value)} placeholder="203.0.113.7, 10.0.0.0/8" className="font-mono" />
          </div>
        </div>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">KMS operations (optional)</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {["encrypt", "decrypt", "sign", "verify"].map((op) => (
              <label key={op} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className={CHECKBOX}
                  checked={scopes.includes(`kms:${op}`)}
                  onChange={(ev) => setScopes(ev.target.checked ? [...scopes, `kms:${op}`] : scopes.filter((x) => x !== `kms:${op}`))}
                />
                {op[0].toUpperCase() + op.slice(1)}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Lets the token call the project&apos;s KMS keys. Leave empty for secrets only.</p>
        </fieldset>
        <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <SubmitButton pending={busy} disabled={!name.trim() || !envs.length}>Create token</SubmitButton>
        </div>
      </form>
    </Modal>
  )
}
