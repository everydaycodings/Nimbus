"use client"

import { ArrowsClockwiseIcon, ClockClockwiseIcon, CopyIcon, DatabaseIcon, EyeIcon, EyeSlashIcon, LightningIcon, PencilSimpleIcon, PlugsConnectedIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react"
import { useEffect, useState } from "react"

import { useLoad } from "@/components/secrets/access-view"
import { api, copySecret, errorText } from "@/components/secrets/client"
import { Empty, Tabs, TEXTAREA, useBusy } from "@/components/secrets/pki-ui"
import { Confirm, Modal, SELECT, CHECKBOX } from "@/components/secrets/ui"
import { SubmitButton } from "@/components/submit-button"
import { useNotice } from "@/components/toaster"
import { Button } from "@/components/ui/button"
import { GuideLink } from "@/components/secrets/guide-link"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DEFAULT_PORT, DEFAULT_TEMPLATE, ENGINES, ENGINE_LABEL, fmtTtl, type Engine } from "@/lib/secrets/dyn-consts"
import { cn } from "@/lib/utils"

type Conn = { id: string; name: string; engine: Engine; host: string; port: number; database: string; tls: boolean; ca: string; adminUser: string; createSql: string; revokeSql: string; defaultTtl: number; maxTtl: number }
type Lease = { id: string; connection: string; engine: Engine; username: string; issuedBy: string; createdAt: string; expiresAt: string; state: "active" | "expired" | "revoked" | "failed"; error: string | null }
type Rotation = { id: string; key: string; env: string; connection: string; engine: Engine; username: string; usernameB: string | null; usernameKey: string | null; mode: "single" | "alternate"; active: string | null; intervalDays: number | null; nextAt: string | null; lastAt: string | null; error: string | null; connectionId: string; secretId: string }
type Data = { connections: Conn[]; leases: Lease[]; rotations: Rotation[] }
type Issued = { username: string; password: string; url: string; host: string; port: number; database: string; expiresAt: string; engine: Engine }

const when = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" })
const left = (iso: string) => {
  const s = Math.round((new Date(iso).getTime() - Date.now()) / 1000)
  if (s <= 0) return "ended"
  return s < 90 ? `${s}s left` : s < 5400 ? `${Math.round(s / 60)} min left` : s < 172800 ? `${Math.round(s / 3600)} h left` : `${Math.round(s / 86400)} days left`
}
const STATE: Record<Lease["state"], [string, string]> = {
  active: ["Active", "bg-brand/10 text-brand"],
  expired: ["Ending…", "bg-warning/10 text-warning"],
  revoked: ["Revoked", "bg-muted text-muted-foreground"],
  failed: ["Revoke failed", "bg-destructive/10 text-destructive"],
}

export function DynamicView({ projectId, role }: { projectId: string; role: string }) {
  const base = `/projects/${projectId}/dynamic`
  const { data, error, reload } = useLoad<Data>(base)
  const admin = role === "admin"
  const canIssue = role !== "viewer"
  const [tab, setTab] = useState<"connections" | "leases" | "rotations">("connections")
  const [dlg, setDlg] = useState<{ kind: "conn"; conn?: Conn } | { kind: "generate"; conn: Conn } | { kind: "rotation" } | { kind: "delete"; conn: Conn } | { kind: "revoke"; lease: Lease } | { kind: "renew"; lease: Lease } | { kind: "stop"; rot: Rotation } | { kind: "issued"; issued: Issued; fresh: boolean } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const notify = useNotice()

  // Leases end by themselves: look again every so often while someone is on the list.
  useEffect(() => {
    if (tab === "connections") return
    const t = setInterval(reload, 15_000)
    return () => clearInterval(t)
  }, [tab, reload])

  const act = (fn: () => Promise<unknown>) => async () => {
    setActionError(null)
    try {
      await fn()
      reload()
    } catch (e) {
      setActionError(errorText(e))
    }
  }

  const tabs = [["connections", "Connections"], ...(canIssue ? [["leases", "Leases"] as const] : []), ...(admin ? [["rotations", "Rotation"] as const] : [])] as const
  const active = data?.leases.filter((l) => l.state === "active").length ?? 0

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold tracking-tight">Dynamic secrets</h2>
          <p className="max-w-prose text-sm text-pretty text-muted-foreground">
            Short-lived database users made on request and removed when they run out, and passwords Nimbus changes on a schedule.
          </p>
        </div>
        {admin && tab === "connections" && (
          <Button onClick={() => setDlg({ kind: "conn" })}>
            <PlusIcon />
            Add connection
          </Button>
        )}
        {admin && tab === "rotations" && (
          <Button onClick={() => setDlg({ kind: "rotation" })} disabled={!data?.connections.length}>
            <PlusIcon />
            Add rotation
          </Button>
        )}
      </div>
      <Tabs label="Dynamic secrets" tabs={tabs} value={tab} onChange={setTab} />
      <p role="alert" className="text-sm text-destructive empty:hidden">{error ?? actionError}</p>

      {tab === "connections" &&
        (data?.connections.length === 0 ? (
          <Empty icon={<DatabaseIcon />} title="No database connections">
            {admin ? "Add a PostgreSQL, MySQL, Redis or MongoDB server and the admin login Nimbus uses to create users on it." : "A project admin adds the databases people can ask for credentials on."}{" "}
            <GuideLink to="dynamic-database-credentials-and-rotation">Ask for credentials from the CLI or API</GuideLink>
          </Empty>
        ) : (
          <ul className="flex flex-col divide-y rounded-xl border">
            {data?.connections.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {c.name}
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">{ENGINE_LABEL[c.engine]}</span>
                    {c.tls && <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">TLS</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {c.host}:{c.port}
                    {c.database && ` / ${c.database}`} · lease {fmtTtl(c.defaultTtl)}, up to {fmtTtl(c.maxTtl)}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {canIssue && (
                    <Button size="sm" onClick={() => setDlg({ kind: "generate", conn: c })}>
                      <LightningIcon />
                      Generate
                    </Button>
                  )}
                  {admin && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={testing === c.id}
                        onClick={async () => {
                          setTesting(c.id)
                          try {
                            const r = await api<{ ok: boolean; message: string }>(`${base}/${c.id}`, "POST", { action: "test" })
                            notify({ text: r.ok ? r.message : `Couldn't connect: ${r.message}`, error: !r.ok })
                            if (!r.ok) setActionError(`${c.name}: ${r.message}`)
                            else setActionError(null)
                          } catch (e) {
                            setActionError(errorText(e))
                          }
                          setTesting(null)
                        }}
                      >
                        <PlugsConnectedIcon />
                        {testing === c.id ? "Testing…" : "Test"}
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`Edit ${c.name}`} onClick={() => setDlg({ kind: "conn", conn: c })}>
                        <PencilSimpleIcon />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`Delete ${c.name}`} onClick={() => setDlg({ kind: "delete", conn: c })}>
                        <TrashIcon />
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ))}

      {tab === "leases" &&
        (data?.leases.length === 0 ? (
          <Empty icon={<ClockClockwiseIcon />} title="No leases yet">Generate credentials on a connection and they show up here until they end.</Empty>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">{active} active · the newest 100 are listed.</p>
            <ul className="flex flex-col divide-y rounded-xl border">
              {data?.leases.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <code className="font-medium">{l.username}</code>
                      <span className={cn("rounded px-1.5 py-0.5 text-xs", STATE[l.state][1])}>{STATE[l.state][0]}</span>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {l.connection} · by {l.issuedBy} · {l.state === "active" ? `${left(l.expiresAt)} (ends ${when.format(new Date(l.expiresAt))})` : `ended ${when.format(new Date(l.expiresAt))}`}
                    </p>
                    {l.error && <p className="text-xs text-destructive">{l.error}</p>}
                  </div>
                  <div className="flex items-center gap-1">
                    {l.state === "active" && (
                      <>
                        <Button variant="outline" size="sm" onClick={act(async () => setDlg({ kind: "issued", fresh: false, issued: await api<Issued>(`${base}/leases/${l.id}`) }))}>
                          <EyeIcon />
                          Reveal
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setDlg({ kind: "renew", lease: l })}>
                          <ArrowsClockwiseIcon />
                          Renew
                        </Button>
                      </>
                    )}
                    {l.state !== "revoked" && (
                      <Button variant="ghost" size="sm" onClick={() => setDlg({ kind: "revoke", lease: l })}>
                        <TrashIcon />
                        Revoke
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}

      {tab === "rotations" && admin && (
        <>
          <p className="max-w-prose text-xs text-pretty text-muted-foreground">
            Nimbus sets a new password on the database user, then saves it to the secret as a new version (see its history). A protected environment doesn&apos;t ask for a change request for this; its admins are told. If it fails, the secret keeps its old value and the admins are told.
          </p>
          {data?.rotations.length === 0 ? (
            <Empty icon={<ArrowsClockwiseIcon />} title="No rotations">Attach one to a secret that holds a database password.</Empty>
          ) : (
            <ul className="flex flex-col divide-y rounded-xl border">
              {data?.rotations.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      <code>{r.key}</code>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">{r.env}</span>
                      {r.error && <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-normal text-destructive">Failed</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {r.connection} · {r.mode === "alternate" ? `${r.username} / ${r.usernameB} in turn (now ${r.active})` : r.username} ·{" "}
                      {r.intervalDays ? `every ${r.intervalDays} day${r.intervalDays === 1 ? "" : "s"}${r.nextAt ? `, next ${when.format(new Date(r.nextAt))}` : ""}` : "by hand"}
                      {r.lastAt && ` · last ${when.format(new Date(r.lastAt))}`}
                    </p>
                    {r.error && <p className="text-xs text-destructive">{r.error}</p>}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={act(async () => {
                        await api(`${base}/rotations/${r.id}`, "POST")
                        notify({ text: `Rotated ${r.key}. It's a new version in the history.` })
                      })}
                    >
                      <ArrowsClockwiseIcon />
                      Rotate now
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`Stop rotating ${r.key}`} onClick={() => setDlg({ kind: "stop", rot: r })}>
                      <TrashIcon />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {dlg?.kind === "conn" && <ConnDialog base={base} conn={dlg.conn} onClose={() => setDlg(null)} onDone={reload} />}
      {dlg?.kind === "generate" && (
        <GenerateDialog
          base={base}
          conn={dlg.conn}
          onClose={() => setDlg(null)}
          onIssued={(issued) => {
            setDlg({ kind: "issued", issued, fresh: true })
            reload()
          }}
        />
      )}
      {dlg?.kind === "issued" && <IssuedDialog issued={dlg.issued} fresh={dlg.fresh} onClose={() => setDlg(null)} />}
      {dlg?.kind === "rotation" && data && <RotationDialog base={base} projectId={projectId} conns={data.connections} onClose={() => setDlg(null)} onDone={reload} />}
      {dlg?.kind === "delete" && (
        <Confirm title={`Delete ${dlg.conn.name}?`} description="Nimbus forgets the admin login. Users it already made on the database aren't touched." action="Delete connection" danger run={() => api(`${base}/${dlg.conn.id}`, "DELETE").then(reload)} onClose={() => setDlg(null)} />
      )}
      {dlg?.kind === "revoke" && (
        <Confirm title={`Revoke ${dlg.lease.username}?`} description="Nimbus removes this user from the database now. Anything still using it loses access." action="Revoke" danger run={() => api(`${base}/leases/${dlg.lease.id}`, "DELETE").then(reload)} onClose={() => setDlg(null)} />
      )}
      {dlg?.kind === "stop" && (
        <Confirm title={`Stop rotating ${dlg.rot.key}?`} description="The secret keeps its current value and the database user keeps its password." action="Stop rotating" run={() => api(`${base}/rotations/${dlg.rot.id}`, "DELETE").then(reload)} onClose={() => setDlg(null)} />
      )}
      {dlg?.kind === "renew" && <RenewDialog base={base} lease={dlg.lease} onClose={() => setDlg(null)} onDone={reload} />}
    </div>
  )
}

function ConnDialog({ base, conn, onClose, onDone }: { base: string; conn?: Conn; onClose: () => void; onDone: () => void }) {
  const { busy, error, setError, setBusy } = useBusy()
  const [fields, setFields] = useState<Record<string, string>>({})
  const [engine, setEngine] = useState<Engine>(conn?.engine ?? "postgres")
  const [port, setPort] = useState(String(conn?.port ?? DEFAULT_PORT.postgres))
  const [create, setCreate] = useState(conn?.createSql ?? DEFAULT_TEMPLATE.postgres.create)
  const [revoke, setRevoke] = useState(conn?.revokeSql ?? DEFAULT_TEMPLATE.postgres.revoke)
  const [tls, setTls] = useState(conn?.tls ?? false)
  const [dirty, setDirty] = useState(Boolean(conn))
  const err = (k: string) => fields[k]
  const pick = (e: Engine) => {
    setEngine(e)
    setPort(String(DEFAULT_PORT[e]))
    if (!dirty) {
      setCreate(DEFAULT_TEMPLATE[e].create)
      setRevoke(DEFAULT_TEMPLATE[e].revoke)
    }
  }
  const redis = engine === "redis"
  return (
    <Modal wide title={conn ? `Edit ${conn.name}` : "Add a database connection"} description="The admin login is sealed with the project key and never shown again." onClose={onClose}>
      <form
        className="grid gap-4"
        autoComplete="off"
        onSubmit={async (e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          setBusy(true)
          setFields({})
          try {
            const body = {
              name: String(f.get("name")),
              host: String(f.get("host")),
              port: Number(port),
              database: String(f.get("database") ?? ""),
              tls,
              ca: String(f.get("ca") ?? ""),
              adminUser: String(f.get("adminUser") ?? ""),
              ...(f.get("adminPassword") ? { adminPassword: String(f.get("adminPassword")) } : {}),
              createSql: create,
              revokeSql: revoke,
              defaultTtl: String(f.get("defaultTtl")),
              maxTtl: String(f.get("maxTtl")),
            }
            if (conn) await api(`${base}/${conn.id}`, "PATCH", body)
            else await api(base, "POST", { ...body, engine })
            onDone()
            onClose()
          } catch (er) {
            setError(errorText(er))
            setFields((er as { fields?: Record<string, string> }).fields ?? {})
            setBusy(false)
          }
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="dc-name">Name</Label>
            <Input id="dc-name" name="name" maxLength={60} required autoFocus defaultValue={conn?.name} placeholder="orders-db" aria-invalid={Boolean(err("name"))} />
            <FieldError text={err("name")} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="dc-engine">Type</Label>
            <select id="dc-engine" className={SELECT} value={engine} disabled={Boolean(conn)} onChange={(e) => pick(e.target.value as Engine)}>
              {ENGINES.map((e) => <option key={e} value={e}>{ENGINE_LABEL[e]}</option>)}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="dc-host">Host</Label>
            <Input id="dc-host" name="host" required defaultValue={conn?.host} placeholder="db.internal" aria-invalid={Boolean(err("host"))} />
            <FieldError text={err("host")} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="dc-port">Port</Label>
            <Input id="dc-port" name="port" inputMode="numeric" required value={port} onChange={(e) => setPort(e.target.value)} aria-invalid={Boolean(err("port"))} />
            <FieldError text={err("port")} />
          </div>
          {!redis && (
            <div className="grid gap-2">
              <Label htmlFor="dc-db">{engine === "mongodb" ? "Authentication database" : "Database"}</Label>
              <Input id="dc-db" name="database" defaultValue={conn?.database ?? (engine === "mongodb" ? "admin" : "")} placeholder={engine === "postgres" ? "postgres" : engine === "mongodb" ? "admin" : ""} aria-invalid={Boolean(err("database"))} />
              <FieldError text={err("database")} />
            </div>
          )}
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" className={CHECKBOX} checked={tls} onChange={(e) => setTls(e.target.checked)} />
            Connect with TLS (certificate checked)
          </label>
          {tls && (
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="dc-ca">CA certificate (PEM, optional)</Label>
              <textarea id="dc-ca" name="ca" className={TEXTAREA} rows={4} spellCheck={false} defaultValue={conn?.ca} placeholder="-----BEGIN CERTIFICATE-----" aria-invalid={Boolean(err("ca"))} />
              <p className="text-xs text-muted-foreground">Only for a server on a private CA or a self-signed certificate. Leave empty to trust the usual public roots.</p>
              <FieldError text={err("ca")} />
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="dc-au">Admin user{redis ? " (optional)" : ""}</Label>
            <Input id="dc-au" name="adminUser" required={!redis} defaultValue={conn?.adminUser} autoComplete="off" aria-invalid={Boolean(err("adminUser"))} />
            <FieldError text={err("adminUser")} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="dc-ap">Admin password{conn ? " (leave empty to keep)" : redis ? " (optional)" : ""}</Label>
            <Input id="dc-ap" name="adminPassword" type="password" required={!conn && !redis} autoComplete="new-password" aria-invalid={Boolean(err("adminPassword"))} />
            <FieldError text={err("adminPassword")} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="dc-dt">Default lease</Label>
            <Input id="dc-dt" name="defaultTtl" defaultValue={fmtTtl(conn?.defaultTtl ?? 3600)} aria-invalid={Boolean(err("defaultTtl"))} />
            <FieldError text={err("defaultTtl")} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="dc-mt">Longest lease</Label>
            <Input id="dc-mt" name="maxTtl" defaultValue={fmtTtl(conn?.maxTtl ?? 86400)} aria-invalid={Boolean(err("maxTtl"))} />
            <FieldError text={err("maxTtl")} />
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="dc-create">Creation {engine === "mongodb" ? "command" : redis ? "commands" : "statements"}</Label>
          <textarea id="dc-create" className={TEXTAREA} rows={5} spellCheck={false} value={create} onChange={(e) => (setCreate(e.target.value), setDirty(true))} aria-invalid={Boolean(err("createSql"))} />
          <FieldError text={err("createSql")} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="dc-revoke">Revoke {engine === "mongodb" ? "command" : redis ? "commands" : "statements"}</Label>
          <textarea id="dc-revoke" className={TEXTAREA} rows={4} spellCheck={false} value={revoke} onChange={(e) => (setRevoke(e.target.value), setDirty(true))} aria-invalid={Boolean(err("revokeSql"))} />
          <FieldError text={err("revokeSql")} />
        </div>
        <p className="text-xs text-pretty text-muted-foreground">
          <code>{"{{username}}"}</code> and <code>{"{{password}}"}</code> are made up for each lease. <code>{"{{expiry}}"}</code> is the hard limit (issue time plus the longest lease), a backstop if Nimbus is down; Nimbus revokes at the lease&apos;s own end. Times: 30m, 2h, 7d.
        </p>
        <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <SubmitButton pending={busy}>{conn ? "Save" : "Add connection"}</SubmitButton>
        </div>
      </form>
    </Modal>
  )
}

const FieldError = ({ text }: { text?: string }) => <p role="alert" className="text-xs text-destructive empty:hidden">{text}</p>

function GenerateDialog({ base, conn, onClose, onIssued }: { base: string; conn: Conn; onClose: () => void; onIssued: (i: Issued) => void }) {
  const { busy, error, setError, setBusy } = useBusy()
  return (
    <Modal title={`Generate credentials on ${conn.name}`} description="Nimbus creates a new database user now and removes it when the lease ends." onClose={onClose}>
      <form
        className="grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          try {
            onIssued(await api<Issued>(`${base}/${conn.id}`, "POST", { action: "generate", ttl: String(new FormData(e.currentTarget).get("ttl")) }))
          } catch (er) {
            setError(errorText(er))
            setBusy(false)
          }
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor="gen-ttl">Lease</Label>
          <Input id="gen-ttl" name="ttl" defaultValue={fmtTtl(conn.defaultTtl)} autoFocus />
          <p className="text-xs text-muted-foreground">Up to {fmtTtl(conn.maxTtl)}. Like 30m, 2h or 7d.</p>
        </div>
        <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <SubmitButton pending={busy}>Generate</SubmitButton>
        </div>
      </form>
    </Modal>
  )
}

function IssuedDialog({ issued, fresh, onClose }: { issued: Issued; fresh: boolean; onClose: () => void }) {
  const notify = useNotice()
  const [show, setShow] = useState(false)
  const copy = (t: string) => copySecret(t).then(() => notify({ text: "Copied. It clears from the clipboard in 30 seconds." }))
  const line = (k: string, v: string, secret?: boolean) => (
    <div className="grid gap-1">
      <span className="text-xs text-muted-foreground">{k}</span>
      <div className="flex items-center gap-1">
        <code className="min-w-0 flex-1 rounded-md bg-muted/50 px-2.5 py-1.5 text-sm break-all">{secret && !show ? "•".repeat(24) : v}</code>
        {secret && (
          <Button variant="ghost" size="icon-sm" aria-label={show ? "Hide" : "Show"} onClick={() => setShow(!show)}>
            {show ? <EyeSlashIcon /> : <EyeIcon />}
          </Button>
        )}
        <Button variant="ghost" size="icon-sm" aria-label={`Copy ${k.toLowerCase()}`} onClick={() => copy(v)}>
          <CopyIcon />
        </Button>
      </div>
    </div>
  )
  return (
    <Modal title={fresh ? "Credentials ready" : "Credentials"} description={`Valid until ${when.format(new Date(issued.expiresAt))}. ${fresh ? "Copy them now. Opening them again is recorded in the audit log." : "Viewing them is recorded in the audit log."}`} onClose={onClose}>
      <div className="grid gap-3">
        {line("Host", `${issued.host}:${issued.port}`)}
        {issued.database && line("Database", issued.database)}
        {line("Username", issued.username)}
        {line("Password", issued.password, true)}
        {line("Connection URL", issued.url, true)}
      </div>
      <div className="flex justify-end">
        <Button onClick={onClose}>Done</Button>
      </div>
    </Modal>
  )
}

function RenewDialog({ base, lease, onClose, onDone }: { base: string; lease: Lease; onClose: () => void; onDone: () => void }) {
  const { busy, error, setError, setBusy } = useBusy()
  return (
    <Modal title={`Renew ${lease.username}`} description="The lease runs for this long from now, up to the connection's longest lease counted from when it was issued." onClose={onClose}>
      <form
        className="grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          try {
            await api(`${base}/leases/${lease.id}`, "PATCH", { ttl: String(new FormData(e.currentTarget).get("ttl")) })
            onDone()
            onClose()
          } catch (er) {
            setError(errorText(er))
            setBusy(false)
          }
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor="rn-ttl">Extend to</Label>
          <Input id="rn-ttl" name="ttl" defaultValue="1h" autoFocus />
        </div>
        <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <SubmitButton pending={busy}>Renew</SubmitButton>
        </div>
      </form>
    </Modal>
  )
}

type Hit = { id: string; key: string; env: string; folder: string }

function RotationDialog({ base, projectId, conns, onClose, onDone }: { base: string; projectId: string; conns: Conn[]; onClose: () => void; onDone: () => void }) {
  const { busy, error, setError, setBusy } = useBusy()
  const [fields, setFields] = useState<Record<string, string>>({})
  const [q, setQ] = useState("")
  const [hits, setHits] = useState<Hit[]>([])
  const [secret, setSecret] = useState<Hit | null>(null)
  const [connId, setConnId] = useState(conns[0]?.id ?? "")
  const [mode, setMode] = useState<"single" | "alternate">("single")
  const [every, setEvery] = useState("30")
  const conn = conns.find((c) => c.id === connId)
  const twoUser = conn?.engine === "postgres" || conn?.engine === "mysql"

  useEffect(() => {
    const term = q.trim()
    if (!term || secret) return
    let live = true
    const t = setTimeout(() => api<{ results: Hit[] }>(`/projects/${projectId}/search?q=${encodeURIComponent(term)}`).then((r) => live && setHits(r.results.slice(0, 6))).catch(() => {}), 200)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [q, secret, projectId])

  return (
    <Modal wide title="Rotate a secret's password" description="Pick the secret that holds a database password and the database user it belongs to." onClose={onClose}>
      <form
        className="grid gap-4"
        autoComplete="off"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!secret) return setError("Pick the secret first.")
          const f = new FormData(e.currentTarget)
          setBusy(true)
          setFields({})
          try {
            await api(`${base}/rotations`, "POST", {
              secretId: secret.id,
              connectionId: connId,
              username: String(f.get("username")),
              mode: twoUser ? mode : "single",
              ...(twoUser && mode === "alternate" ? { usernameB: String(f.get("usernameB")), usernameKey: String(f.get("usernameKey")) } : {}),
              intervalDays: every.trim() ? Number(every) : null,
            })
            onDone()
            onClose()
          } catch (er) {
            setError(errorText(er))
            setFields((er as { fields?: Record<string, string> }).fields ?? {})
            setBusy(false)
          }
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor="rt-secret">Secret</Label>
          {secret ? (
            <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
              <code className="font-medium">{secret.key}</code>
              <span className="text-muted-foreground">{secret.env}{secret.folder ? ` / ${secret.folder}` : ""}</span>
              <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => (setSecret(null), setQ(""))}>Change</Button>
            </div>
          ) : (
            <>
              <Input id="rt-secret" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by key name" autoFocus aria-invalid={Boolean(fields.secretId)} />
              {hits.length > 0 && q.trim() && (
                <ul className="divide-y rounded-md border text-sm">
                  {hits.map((h) => (
                    <li key={h.id}>
                      <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left outline-none hover:bg-muted/40 focus-visible:bg-muted/40" onClick={() => (setSecret(h), setHits([]))}>
                        <code>{h.key}</code>
                        <span className="text-muted-foreground">{h.env}{h.folder ? ` / ${h.folder}` : ""}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="rt-conn">Connection</Label>
            <select id="rt-conn" className={SELECT} value={connId} onChange={(e) => setConnId(e.target.value)}>
              {conns.map((c) => <option key={c.id} value={c.id}>{c.name} ({ENGINE_LABEL[c.engine]})</option>)}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="rt-every">Every (days)</Label>
            <Input id="rt-every" inputMode="numeric" value={every} onChange={(e) => setEvery(e.target.value)} placeholder="Empty: by hand" aria-invalid={Boolean(fields.intervalDays)} />
            <FieldError text={fields.intervalDays} />
          </div>
          {twoUser && (
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="rt-mode">Method</Label>
              <select id="rt-mode" className={SELECT} value={mode} onChange={(e) => setMode(e.target.value as "single" | "alternate")}>
                <option value="single">Change one user&apos;s password</option>
                <option value="alternate">Alternate between two users (apps don&apos;t break mid-rotation)</option>
              </select>
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="rt-user">{mode === "alternate" && twoUser ? "First database user" : "Database user"}</Label>
            <Input id="rt-user" name="username" required aria-invalid={Boolean(fields.username)} />
            <FieldError text={fields.username} />
          </div>
          {twoUser && mode === "alternate" && (
            <>
              <div className="grid gap-2">
                <Label htmlFor="rt-userb">Second database user</Label>
                <Input id="rt-userb" name="usernameB" required aria-invalid={Boolean(fields.usernameB)} />
                <FieldError text={fields.usernameB} />
              </div>
              <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor="rt-key">Secret that holds the current user name</Label>
                <Input id="rt-key" name="usernameKey" required placeholder="DB_USER" aria-invalid={Boolean(fields.usernameKey)} />
                <FieldError text={fields.usernameKey} />
                <p className="text-xs text-pretty text-muted-foreground">Written next to the password each time, in the same folder. Both users must exist; the one that is not current keeps its old password until its turn.</p>
              </div>
            </>
          )}
        </div>
        <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <SubmitButton pending={busy}>Add rotation</SubmitButton>
        </div>
      </form>
    </Modal>
  )
}
