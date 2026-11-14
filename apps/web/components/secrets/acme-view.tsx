"use client"

import { ArrowsClockwiseIcon, CertificateIcon, CopyIcon, GlobeIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react"
import { useEffect, useRef, useState } from "react"

import { useLoad } from "@/components/secrets/access-view"
import { api, errorText } from "@/components/secrets/client"
import { Empty, Expiry, TEXTAREA, useBusy } from "@/components/secrets/pki-ui"
import { Loading, Modal, SELECT } from "@/components/secrets/ui"
import { SubmitButton } from "@/components/submit-button"
import { useNotice } from "@/components/toaster"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CRED_FIELDS, type DnsProvider } from "@/lib/secrets/acme-fields"

type Account = { id: string; directory: string; email: string }
type Cred = { id: string; name: string; provider: DnsProvider }
type Order = { id: string; name: string; domains: string[]; challenge: string; status: "working" | "awaiting" | "issued" | "failed"; error: string | null; records: { domain: string; name: string; value: string }[] }
type Data = { accounts: Account[]; creds: Cred[]; orders: Order[]; customAllowed: boolean }

const PROVIDERS: Record<DnsProvider, string> = { cloudflare: "Cloudflare", route53: "Amazon Route 53", digitalocean: "DigitalOcean" }
const dirName = (d: string) => (d === "staging" ? "Let's Encrypt staging" : d === "production" ? "Let's Encrypt" : d.replace("custom:", ""))

export function AcmeTab({ projectId, role, onIssued }: { projectId: string; role: string; onIssued: () => void }) {
  const notify = useNotice()
  const base = `/projects/${projectId}/acme`
  const { data, error, reload } = useLoad<Data>(base)
  const [dlg, setDlg] = useState<"account" | "dns" | "order" | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const admin = role === "admin"
  const busy = data?.orders.some((o) => o.status === "working")

  // Orders run in the background: poll while one is working, and tell the Store when one lands.
  const seen = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (!busy) return
    const t = setInterval(reload, 3000)
    return () => clearInterval(t)
  }, [busy, reload])
  useEffect(() => {
    if (!data) return
    const done = data.orders.filter((o) => o.status === "issued").map((o) => o.id)
    if (seen.current && done.some((id) => !seen.current!.has(id))) {
      notify({ text: "Certificate issued. It's in the Store." })
      onIssued()
    }
    seen.current = new Set(done)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const act = (fn: () => Promise<unknown>) => async () => {
    setActionError(null)
    try {
      await fn()
      reload()
    } catch (e) {
      setActionError(errorText(e))
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <p className="max-w-prose flex-1 basis-72 text-sm text-pretty text-muted-foreground">
          Free certificates from Let&apos;s Encrypt (or another ACME server), renewed by the worker 30 days before they expire. Choose how to prove you own the name.
        </p>
        {role !== "viewer" && (
          <Button onClick={() => setDlg("order")} disabled={!data?.accounts.length}>
            <CertificateIcon />
            Get a certificate
          </Button>
        )}
      </div>
      <p role="alert" className="text-sm text-destructive empty:hidden">{error ?? actionError}</p>

      {data && data.orders.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Orders</h3>
          <ul className="flex flex-col divide-y rounded-xl border">
            {data.orders.slice(0, 8).map((o) => (
              <li key={o.id} className="flex flex-col gap-2 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium">{o.name}</span>
                  <span className="text-muted-foreground">{o.domains.join(", ")} · {o.challenge}</span>
                  <span className={`ml-auto rounded px-1.5 py-0.5 text-xs ${o.status === "issued" ? "bg-brand/10 text-brand" : o.status === "failed" ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning"}`}>
                    {{ working: "Working…", awaiting: "Add the record, then verify", issued: "Issued", failed: "Failed" }[o.status]}
                  </span>
                  {role !== "viewer" && o.status !== "working" && (
                    <Button variant="ghost" size="icon-sm" aria-label={`Remove order ${o.name}`} onClick={act(() => api(`${base}/orders/${o.id}`, "DELETE"))}>
                      <TrashIcon />
                    </Button>
                  )}
                </div>
                {o.error && <p className="text-destructive">{o.error}</p>}
                {o.status === "awaiting" && (
                  <div className="flex flex-col gap-2 rounded-lg bg-muted/40 p-3">
                    {o.records.map((r) => (
                      <div key={r.name} className="grid gap-1 text-xs">
                        <span className="text-muted-foreground">TXT record for {r.domain}</span>
                        <div className="flex items-center gap-2"><code className="min-w-0 flex-1 break-all">{r.name}</code><Copy text={r.name} label="name" /></div>
                        <div className="flex items-center gap-2"><code className="min-w-0 flex-1 break-all">{r.value}</code><Copy text={r.value} label="value" /></div>
                      </div>
                    ))}
                    <Button className="w-fit" size="sm" onClick={act(() => api(`${base}/orders/${o.id}/verify`, "POST"))}>Verify</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-medium">Accounts</h3>
          {admin && <Button variant="outline" size="sm" className="ml-auto" onClick={() => setDlg("account")}><PlusIcon />Add account</Button>}
        </div>
        {data?.accounts.length === 0 ? (
          <Empty icon={<CertificateIcon />} title="No ACME account">One per project and directory. Start with the staging directory to try things without rate limits.</Empty>
        ) : (
          <ul className="flex flex-col divide-y rounded-xl border">
            {data?.accounts.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="font-medium">{dirName(a.directory)}</span>
                <span className="min-w-0 truncate text-muted-foreground">{a.email}</span>
                {admin && <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label={`Remove account ${a.email}`} onClick={act(() => api(`${base}/accounts/${a.id}`, "DELETE"))}><TrashIcon /></Button>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-medium">DNS credentials</h3>
          {admin && <Button variant="outline" size="sm" className="ml-auto" onClick={() => setDlg("dns")}><PlusIcon />Add credential</Button>}
        </div>
        <p className="text-xs text-muted-foreground">Used for DNS challenges (and wildcards). Sealed with the project key and never shown again.</p>
        {data && data.creds.length > 0 && (
          <ul className="flex flex-col divide-y rounded-xl border">
            {data.creds.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="font-medium">{c.name}</span>
                <span className="text-muted-foreground">{PROVIDERS[c.provider]}</span>
                {admin && <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label={`Remove ${c.name}`} onClick={act(() => api(`${base}/dns/${c.id}`, "DELETE"))}><TrashIcon /></Button>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {dlg === "account" && data && <AccountDialog base={base} custom={data.customAllowed} onClose={() => setDlg(null)} onDone={reload} />}
      {dlg === "dns" && <DnsDialog base={base} onClose={() => setDlg(null)} onDone={reload} />}
      {dlg === "order" && data && <OrderDialog base={base} data={data} onClose={() => setDlg(null)} onDone={reload} />}
    </div>
  )
}

function Copy({ text, label }: { text: string; label: string }) {
  const notify = useNotice()
  return (
    <Button variant="ghost" size="icon-sm" aria-label={`Copy ${label}`} onClick={() => navigator.clipboard.writeText(text).then(() => notify({ text: "Copied." }))}>
      <CopyIcon />
    </Button>
  )
}

function AccountDialog({ base, custom, onClose, onDone }: { base: string; custom: boolean; onClose: () => void; onDone: () => void }) {
  const { busy, error, setError, setBusy } = useBusy()
  const [dir, setDir] = useState("staging")
  return (
    <Modal title="Add an ACME account" description="You agree to the CA's terms of service by creating it." onClose={onClose}>
      <form
        className="grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          setBusy(true)
          try {
            await api(`${base}/accounts`, "POST", { directory: dir === "custom" ? `custom:${f.get("url")}` : dir, email: f.get("email") })
            onDone()
            onClose()
          } catch (er) {
            setError(errorText(er))
            setBusy(false)
          }
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor="ac-dir">Directory</Label>
          <select id="ac-dir" className={SELECT} value={dir} onChange={(e) => setDir(e.target.value)}>
            <option value="staging">Let&apos;s Encrypt staging (test certificates)</option>
            <option value="production">Let&apos;s Encrypt production</option>
            {custom && <option value="custom">Custom ACME directory</option>}
          </select>
        </div>
        {dir === "custom" && <div className="grid gap-2"><Label htmlFor="ac-url">Directory URL</Label><Input id="ac-url" name="url" type="url" required /></div>}
        <div className="grid gap-2"><Label htmlFor="ac-mail">Contact email</Label><Input id="ac-mail" name="email" type="email" required autoFocus /></div>
        <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><SubmitButton pending={busy}>Create account</SubmitButton></div>
      </form>
    </Modal>
  )
}

function DnsDialog({ base, onClose, onDone }: { base: string; onClose: () => void; onDone: () => void }) {
  const { busy, error, setError, setBusy } = useBusy()
  const [p, setP] = useState<DnsProvider>("cloudflare")
  return (
    <Modal title="Add a DNS credential" onClose={onClose}>
      <form
        className="grid gap-4"
        autoComplete="off"
        onSubmit={async (e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          setBusy(true)
          try {
            await api(`${base}/dns`, "POST", { name: f.get("name"), provider: p, creds: Object.fromEntries(CRED_FIELDS[p].map(({ key }) => [key, String(f.get(key))])) })
            onDone()
            onClose()
          } catch (er) {
            setError(errorText(er))
            setBusy(false)
          }
        }}
      >
        <div className="grid gap-2"><Label htmlFor="dns-name">Name</Label><Input id="dns-name" name="name" maxLength={60} required autoFocus placeholder="Main Cloudflare" /></div>
        <div className="grid gap-2">
          <Label htmlFor="dns-p">Provider</Label>
          <select id="dns-p" className={SELECT} value={p} onChange={(e) => setP(e.target.value as DnsProvider)}>
            {Object.entries(PROVIDERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        {CRED_FIELDS[p].map(({ key, label }) => (
          <div className="grid gap-2" key={`${p}-${key}`}><Label htmlFor={`dns-${key}`}>{label}</Label><Input id={`dns-${key}`} name={key} type="password" autoComplete="off" required /></div>
        ))}
        <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><SubmitButton pending={busy}>Save</SubmitButton></div>
      </form>
    </Modal>
  )
}

function OrderDialog({ base, data, onClose, onDone }: { base: string; data: Data; onClose: () => void; onDone: () => void }) {
  const { busy, error, setError, setBusy } = useBusy()
  const [ch, setCh] = useState("http-01")
  return (
    <Modal title="Get a certificate" onClose={onClose}>
      <form
        className="grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          setBusy(true)
          try {
            await api(`${base}/orders`, "POST", {
              accountId: f.get("account"),
              name: f.get("name"),
              domains: String(f.get("domains")).split(/[\s,]+/).filter(Boolean),
              challenge: ch,
              credId: ch === "dns-01" ? f.get("cred") : null,
              autoRenew: ch !== "manual" && f.get("renew") === "on",
            })
            onDone()
            onClose()
          } catch (er) {
            setError(errorText(er))
            setBusy(false)
          }
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor="or-acct">Account</Label>
          <select id="or-acct" name="account" className={SELECT}>{data.accounts.map((a) => <option key={a.id} value={a.id}>{dirName(a.directory)} ({a.email})</option>)}</select>
        </div>
        <div className="grid gap-2"><Label htmlFor="or-dom">Domain names</Label><textarea id="or-dom" name="domains" className={TEXTAREA} rows={2} spellCheck={false} required placeholder="app.example.com, *.example.com" /></div>
        <div className="grid gap-2"><Label htmlFor="or-name">Name in the Store</Label><Input id="or-name" name="name" maxLength={80} placeholder="Defaults to the first domain" /></div>
        <div className="grid gap-2">
          <Label htmlFor="or-ch">Prove ownership with</Label>
          <select id="or-ch" className={SELECT} value={ch} onChange={(e) => setCh(e.target.value)}>
            <option value="http-01">HTTP: the domain points at this Nimbus</option>
            <option value="dns-01">DNS: Cloudflare, Route 53 or DigitalOcean</option>
            <option value="manual">Manual TXT record</option>
          </select>
          {ch === "http-01" && <p className="text-xs text-muted-foreground">The CA fetches /.well-known/acme-challenge/… on port 80 of the domain, so it must reach this server.</p>}
        </div>
        {ch === "dns-01" && (
          <div className="grid gap-2">
            <Label htmlFor="or-cred">DNS credential</Label>
            <select id="or-cred" name="cred" className={SELECT} required>{data.creds.map((c) => <option key={c.id} value={c.id}>{c.name} ({PROVIDERS[c.provider]})</option>)}</select>
            {!data.creds.length && <p className="text-xs text-muted-foreground">Add a credential first.</p>}
          </div>
        )}
        {ch !== "manual" && (
          <label className="flex items-center gap-2 text-sm"><input name="renew" type="checkbox" defaultChecked className="size-4 accent-primary" />Renew automatically 30 days before it expires</label>
        )}
        <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><SubmitButton pending={busy}>Start</SubmitButton></div>
      </form>
    </Modal>
  )
}

// ---- Domain watch -------------------------------------------------------------

type Watch = { id: string; host: string; port: number; subject: string | null; issuer: string | null; notAfter: string | null; checkedAt: string | null; error: string | null }

export function WatchTab({ projectId, role }: { projectId: string; role: string }) {
  const base = `/projects/${projectId}/watches`
  const { data, error, reload } = useLoad<{ watches: Watch[] }>(base)
  const { busy, error: addError, setError, setBusy } = useBusy()
  const [checking, setChecking] = useState<string | null>(null)
  const canWrite = role !== "viewer"
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-prose text-sm text-pretty text-muted-foreground">
        Watch a live site&apos;s certificate. Nimbus connects every hour, shows its expiry and issuer, and warns project admins at 30, 7 and 1 day.
      </p>
      {role === "admin" && (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            const form = e.currentTarget
            const f = new FormData(form)
            setBusy(true)
            setError(null)
            try {
              await api(base, "POST", { host: f.get("host"), port: Number(f.get("port") || 443) })
              form.reset()
              reload()
            } catch (er) {
              setError(errorText(er))
            }
            setBusy(false)
          }}
        >
          <Input name="host" aria-label="Host" placeholder="example.com" className="w-full sm:w-64" required />
          <Input name="port" aria-label="Port" type="number" min={1} max={65535} placeholder="443" className="w-24" />
          <SubmitButton pending={busy}><PlusIcon />Watch</SubmitButton>
        </form>
      )}
      <p role="alert" className="text-sm text-destructive empty:hidden">{error ?? addError}</p>
      {!data ? (
        <Loading />
      ) : data.watches.length === 0 ? (
        <Empty icon={<GlobeIcon />} title="No domains watched">Enter a host and port, like example.com and 443.</Empty>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border">
          {data.watches.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
              <span className="font-medium">{w.host}:{w.port}</span>
              {w.error ? <span className="text-destructive">{w.error}</span> : <span className="min-w-0 truncate text-muted-foreground">{w.issuer}</span>}
              <span className="ml-auto flex items-center gap-1">
                {w.notAfter && !w.error && <Expiry at={w.notAfter} />}
                {canWrite && (
                  <>
                    <Button variant="ghost" size="icon-sm" aria-label={`Check ${w.host} now`} disabled={checking === w.id} onClick={async () => { setChecking(w.id); await api(`${base}/${w.id}/check`, "POST").catch(() => {}); setChecking(null); reload() }}><ArrowsClockwiseIcon /></Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`Stop watching ${w.host}`} onClick={async () => { await api(`${base}/${w.id}`, "DELETE").catch(() => {}); reload() }}><TrashIcon /></Button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
