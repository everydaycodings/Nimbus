"use client"

import { CertificateIcon, CopyIcon, DownloadSimpleIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react"
import { useState } from "react"

import { useLoad } from "@/components/secrets/access-view"
import { api, errorText } from "@/components/secrets/client"
import { Empty, Expiry, TEXTAREA, useBusy } from "@/components/secrets/pki-ui"
import { Confirm, Loading, Modal, SELECT } from "@/components/secrets/ui"
import { SubmitButton } from "@/components/submit-button"
import { useNotice } from "@/components/toaster"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Template = { id: string; name: string; kind: "server" | "client"; sanPatterns: string[]; maxTtlDays: number }
type Ca = { id: string; name: string; parentId: string | null; subject: string; notAfter: string; crlUrl: string; issued: number; revoked: number; templates: Template[] }

const lines = (s: string) => s.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean)

export function CaTab({ projectId, role, onIssued }: { projectId: string; role: string; onIssued: () => void }) {
  const notify = useNotice()
  const { data, error, reload } = useLoad<{ cas: Ca[] }>(`/projects/${projectId}/cas`)
  const [dlg, setDlg] = useState<{ type: "new" } | { type: "tpl" | "issue" | "delete"; ca: Ca } | null>(null)
  const admin = role === "admin"
  const base = `/projects/${projectId}/cas`
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="max-w-prose flex-1 basis-72 text-sm text-pretty text-muted-foreground">
          Your own certificate authority. Keys are sealed with the project key and signing happens on the server. Issued certificates land in the Store.
        </p>
        {admin && (
          <Button onClick={() => setDlg({ type: "new" })}>
            <PlusIcon />
            New CA
          </Button>
        )}
      </div>
      <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
      {!data ? (
        <Loading />
      ) : data.cas.length === 0 ? (
        <Empty icon={<CertificateIcon />} title="No certificate authority">
          Create a root CA, then an intermediate under it to sign with.
        </Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.cas.map((ca) => (
            <li key={ca.id} className="flex flex-col gap-3 rounded-xl border p-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h3 className="font-medium">{ca.name}</h3>
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{ca.parentId ? "Intermediate" : "Root"}</span>
                <span className="ml-auto"><Expiry at={ca.notAfter} /></span>
              </div>
              <p className="text-sm break-words text-muted-foreground">{ca.subject} · {ca.issued} issued, {ca.revoked} revoked</p>
              <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                <span className="shrink-0">CRL</span>
                <code className="min-w-0 truncate">{ca.crlUrl}</code>
                <Button variant="ghost" size="icon-sm" aria-label="Copy CRL address" onClick={() => navigator.clipboard.writeText(ca.crlUrl).then(() => notify({ text: "Copied." }))}>
                  <CopyIcon />
                </Button>
              </div>
              {ca.templates.length > 0 && (
                <ul className="flex flex-col divide-y rounded-lg border text-sm">
                  {ca.templates.map((t) => (
                    <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                      <span className="font-medium">{t.name}</span>
                      <span className="text-muted-foreground">{t.kind === "server" ? "Server TLS" : "Client mTLS"} · up to {t.maxTtlDays} days · {t.sanPatterns.join(", ")}</span>
                      {admin && (
                        <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label={`Delete template ${t.name}`} onClick={async () => { await api(`${base}/${ca.id}/templates/${t.id}`, "DELETE").catch(() => {}); reload() }}>
                          <TrashIcon />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-2">
                {role !== "viewer" && (
                  <Button size="sm" disabled={!ca.templates.length} onClick={() => setDlg({ type: "issue", ca })}>
                    Issue certificate
                  </Button>
                )}
                {admin && <Button size="sm" variant="outline" onClick={() => setDlg({ type: "tpl", ca })}>Add template</Button>}
                <Button size="sm" variant="outline" render={<a href={`/api/v1/secrets${base}/${ca.id}/chain`} download />}>
                  <DownloadSimpleIcon />
                  CA chain
                </Button>
                {admin && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDlg({ type: "delete", ca })}>Delete</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {dlg?.type === "new" && <NewCa base={base} cas={data?.cas ?? []} onClose={() => setDlg(null)} onDone={reload} />}
      {dlg?.type === "tpl" && <NewTemplate url={`${base}/${dlg.ca.id}/templates`} onClose={() => setDlg(null)} onDone={reload} />}
      {dlg?.type === "issue" && <Issue ca={dlg.ca} base={base} onClose={() => setDlg(null)} onDone={() => { reload(); onIssued() }} />}
      {dlg?.type === "delete" && (
        <Confirm
          title={`Delete ${dlg.ca.name}?`}
          description="Its key is destroyed and its CRL stops being served. Certificates it issued stay in the Store but can no longer be revoked."
          action="Delete CA"
          danger
          run={async () => { await api(`${base}/${dlg.ca.id}`, "DELETE"); reload() }}
          onClose={() => setDlg(null)}
        />
      )}
    </div>
  )
}

function NewCa({ base, cas, onClose, onDone }: { base: string; cas: Ca[]; onClose: () => void; onDone: () => void }) {
  const { busy, error, setError, setBusy } = useBusy()
  const [parent, setParent] = useState("")
  return (
    <Modal title="New certificate authority" onClose={onClose}>
      <form
        className="grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          setBusy(true)
          try {
            await api(base, "POST", { name: f.get("name"), cn: f.get("cn"), years: Number(f.get("years")), keyKind: f.get("keyKind"), parentId: f.get("parentId") || null })
            onDone()
            onClose()
          } catch (er) {
            setError(errorText(er))
            setBusy(false)
          }
        }}
      >
        <div className="grid gap-2"><Label htmlFor="ca-name">Name</Label><Input id="ca-name" name="name" maxLength={80} required autoFocus placeholder="Internal intermediate" /></div>
        <div className="grid gap-2"><Label htmlFor="ca-cn">Common name</Label><Input id="ca-cn" name="cn" maxLength={100} required placeholder="Acme Internal CA" /></div>
        <div className="grid gap-2">
          <Label htmlFor="ca-parent">Signed by</Label>
          <select id="ca-parent" name="parentId" className={SELECT} value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">Itself (root CA)</option>
            {cas.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2"><Label htmlFor="ca-years">Valid for (years)</Label><Input key={parent ? "i" : "r"} id="ca-years" name="years" type="number" min={1} max={30} defaultValue={parent ? 3 : 10} required /></div>
          <div className="grid gap-2">
            <Label htmlFor="ca-key">Key</Label>
            <select id="ca-key" name="keyKind" className={SELECT} defaultValue="ec"><option value="ec">ECDSA P-256</option><option value="rsa">RSA 2048</option></select>
          </div>
        </div>
        <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><SubmitButton pending={busy}>Create</SubmitButton></div>
      </form>
    </Modal>
  )
}

function NewTemplate({ url, onClose, onDone }: { url: string; onClose: () => void; onDone: () => void }) {
  const { busy, error, setError, setBusy } = useBusy()
  return (
    <Modal title="New template" description="What a CA may sign: the kind of certificate, the names it may carry and the longest lifetime." onClose={onClose}>
      <form
        className="grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          setBusy(true)
          try {
            await api(url, "POST", { name: f.get("name"), kind: f.get("kind"), sanPatterns: lines(String(f.get("patterns"))), maxTtlDays: Number(f.get("ttl")) })
            onDone()
            onClose()
          } catch (er) {
            setError(errorText(er))
            setBusy(false)
          }
        }}
      >
        <div className="grid gap-2"><Label htmlFor="tpl-name">Name</Label><Input id="tpl-name" name="name" maxLength={80} required autoFocus placeholder="Internal servers" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2"><Label htmlFor="tpl-kind">Kind</Label><select id="tpl-kind" name="kind" className={SELECT}><option value="server">Server TLS</option><option value="client">Client mTLS</option></select></div>
          <div className="grid gap-2"><Label htmlFor="tpl-ttl">Longest lifetime (days)</Label><Input id="tpl-ttl" name="ttl" type="number" min={1} max={3650} defaultValue={90} required /></div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="tpl-pat">Allowed names</Label>
          <textarea id="tpl-pat" name="patterns" className={TEXTAREA} rows={3} spellCheck={false} placeholder={"*.internal.example.com\napi.example.com"} required />
          <p className="text-xs text-muted-foreground">One per line. <code>*.example.com</code> covers anything under it; <code>*</code> allows any name.</p>
        </div>
        <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><SubmitButton pending={busy}>Add template</SubmitButton></div>
      </form>
    </Modal>
  )
}

function Issue({ ca, base, onClose, onDone }: { ca: Ca; base: string; onClose: () => void; onDone: () => void }) {
  const notify = useNotice()
  const { busy, error, setError, setBusy } = useBusy()
  const [tpl, setTpl] = useState(ca.templates[0].id)
  const [csr, setCsr] = useState(false)
  const t = ca.templates.find((x) => x.id === tpl) ?? ca.templates[0]
  return (
    <Modal title={`Issue from ${ca.name}`} onClose={onClose}>
      <form
        className="grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          setBusy(true)
          try {
            await api(`${base}/${ca.id}/issue`, "POST", {
              templateId: tpl,
              name: f.get("name"),
              cn: f.get("cn"),
              sans: lines(String(f.get("sans"))),
              ttlDays: Number(f.get("ttl")),
              keyKind: f.get("keyKind") ?? "ec",
              csr: csr ? String(f.get("csr")) : undefined,
            })
            notify({ text: "Issued. It's in the Store." })
            onDone()
            onClose()
          } catch (er) {
            setError(errorText(er))
            setBusy(false)
          }
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor="is-tpl">Template</Label>
          <select id="is-tpl" className={SELECT} value={tpl} onChange={(e) => setTpl(e.target.value)}>
            {ca.templates.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.kind === "server" ? "server" : "client"})</option>)}
          </select>
          <p className="text-xs text-muted-foreground">Names allowed: {t.sanPatterns.join(", ")}. Up to {t.maxTtlDays} days.</p>
        </div>
        <div className="grid gap-2"><Label htmlFor="is-name">Name in the Store</Label><Input id="is-name" name="name" maxLength={80} placeholder="Defaults to the common name" /></div>
        <div className="grid gap-2"><Label htmlFor="is-cn">Common name</Label><Input id="is-cn" name="cn" maxLength={100} placeholder={csr ? "From the CSR if empty" : "app.internal.example.com"} /></div>
        <div className="grid gap-2"><Label htmlFor="is-sans">Names (SANs)</Label><textarea id="is-sans" name="sans" className={TEXTAREA} rows={2} spellCheck={false} placeholder={csr ? "From the CSR if empty" : "One per line: DNS names, IPs or emails"} /></div>
        <div className="grid gap-2"><Label htmlFor="is-ttl">Lifetime (days)</Label><Input id="is-ttl" name="ttl" type="number" min={1} max={t.maxTtlDays} defaultValue={Math.min(30, t.maxTtlDays)} required /></div>
        <div className="grid gap-2">
          <Label htmlFor="is-mode">Key</Label>
          <select id="is-mode" className={SELECT} value={csr ? "csr" : "gen"} onChange={(e) => setCsr(e.target.value === "csr")}>
            <option value="gen">Nimbus generates it and stores it</option>
            <option value="csr">I have a CSR (my key stays with me)</option>
          </select>
        </div>
        {csr ? (
          <textarea name="csr" className={TEXTAREA} rows={5} spellCheck={false} placeholder="-----BEGIN CERTIFICATE REQUEST-----" required aria-label="Certificate signing request" />
        ) : (
          <select name="keyKind" className={SELECT} aria-label="Key type" defaultValue="ec"><option value="ec">ECDSA P-256</option><option value="rsa">RSA 2048</option></select>
        )}
        <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><SubmitButton pending={busy}>Issue</SubmitButton></div>
      </form>
    </Modal>
  )
}
