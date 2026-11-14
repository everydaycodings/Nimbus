"use client"

import { CertificateIcon, DownloadSimpleIcon, PlusIcon, ShieldCheckIcon, UploadSimpleIcon, WarningIcon } from "@phosphor-icons/react"
import { useRef, useState } from "react"

import { useLoad } from "@/components/secrets/access-view"
import { AcmeTab, WatchTab } from "@/components/secrets/acme-view"
import { CaTab } from "@/components/secrets/ca-view"
import { api, downloadPost, errorText } from "@/components/secrets/client"
import { Empty, Expiry, Row, Tabs, readB64, stamp, useBusy } from "@/components/secrets/pki-ui"
import { Confirm, Loading, Modal, SELECT } from "@/components/secrets/ui"
import { SubmitButton } from "@/components/submit-button"
import { useNotice } from "@/components/toaster"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { CertCard } from "@/lib/secrets/pki"

type Detail = CertCard & { keyMatches: boolean | null; chain: { subject: string; issuer: string; notAfter: string }[] }

const TABS = [["store", "Store"], ["ca", "Private CA"], ["acme", "Let's Encrypt"], ["watch", "Domain watch"]] as const

export function CertsView({ projectId, role }: { projectId: string; role: string }) {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("store")
  const [version, setVersion] = useState(0)
  const bump = () => setVersion((v) => v + 1)
  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-lg font-semibold tracking-tight">Certificates</h2>
      <Tabs label="Certificates" tabs={TABS} value={tab} onChange={setTab} />
      {tab === "store" && <StoreTab key={version} projectId={projectId} role={role} />}
      {tab === "ca" && <CaTab projectId={projectId} role={role} onIssued={bump} />}
      {tab === "acme" && <AcmeTab projectId={projectId} role={role} onIssued={bump} />}
      {tab === "watch" && <WatchTab projectId={projectId} role={role} />}
    </div>
  )
}

function StoreTab({ projectId, role }: { projectId: string; role: string }) {
  const { data, error, reload } = useLoad<{ certs: CertCard[] }>(`/projects/${projectId}/certs`)
  const [open, setOpen] = useState<string | null>(null)
  const [upload, setUpload] = useState(false)
  const canWrite = role !== "viewer"
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="max-w-prose flex-1 basis-72 text-sm text-pretty text-muted-foreground">
          Certificates and their private keys, sealed with the project key. Expiry warnings go to project admins at 30, 7 and 1 day.
        </p>
        {canWrite && (
          <Button onClick={() => setUpload(true)}>
            <UploadSimpleIcon />
            Upload
          </Button>
        )}
      </div>
      <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
      {!data ? (
        <Loading />
      ) : data.certs.length === 0 ? (
        <Empty icon={<CertificateIcon />} title="No certificates yet">
          Upload PEM, DER or PFX files, issue one from a private CA, or get one from Let&apos;s Encrypt.
        </Empty>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border">
          {data.certs.map((c) => (
            <li key={c.id}>
              <button onClick={() => setOpen(c.id)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left outline-none hover:bg-muted/40 focus-visible:bg-muted/40">
                <span className="font-medium">{c.name}</span>
                <span className="min-w-0 truncate text-sm text-muted-foreground">{c.sans[0]?.replace(/^DNS:/, "") ?? c.subject}</span>
                <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                  {c.source === "ca" ? "Private CA" : c.source === "acme" ? "Let's Encrypt" : "Uploaded"}
                  {c.acme?.autoRenew && <span className="rounded bg-brand/10 px-1.5 py-0.5 text-brand">auto-renew</span>}
                  <Expiry at={c.notAfter} revoked={Boolean(c.revokedAt)} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {upload && <UploadDialog projectId={projectId} onClose={() => setUpload(false)} onDone={reload} />}
      {open && <CertDialog projectId={projectId} id={open} role={role} onClose={() => setOpen(null)} onChanged={reload} />}
    </div>
  )
}

function UploadDialog({ projectId, onClose, onDone }: { projectId: string; onClose: () => void; onDone: () => void }) {
  const notify = useNotice()
  const file = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<string[]>([])
  const [names, setNames] = useState<string[]>([])
  const [text, setText] = useState("")
  const { busy, error, setError, setBusy } = useBusy()
  return (
    <Modal title="Upload a certificate" description="Certificate, chain and private key can come as separate files or one bundle. PEM, DER and PFX (with its password) are read." onClose={onClose} wide>
      <form
        className="grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          const pasted = text.trim() ? [btoa(unescape(encodeURIComponent(text)))] : []
          setBusy(true)
          try {
            await api(`/projects/${projectId}/certs`, "POST", { name: f.get("name"), password: f.get("password"), files: [...files, ...pasted] })
            notify({ text: "Certificate added." })
            onDone()
            onClose()
          } catch (err) {
            setError(errorText(err))
            setBusy(false)
          }
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor="cert-name">Name</Label>
          <Input id="cert-name" name="name" maxLength={80} placeholder="Defaults to the common name" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={file}
            type="file"
            multiple
            hidden
            aria-label="Certificate files"
            onChange={async (e) => {
              if (!e.target.files?.length) return
              setNames([...names, ...[...e.target.files].map((f) => f.name)])
              setFiles([...files, ...(await readB64(e.target.files))])
              e.target.value = ""
            }}
          />
          <Button type="button" variant="outline" onClick={() => file.current?.click()}>
            <UploadSimpleIcon />
            Choose files
          </Button>
          <span className="min-w-0 truncate text-sm text-muted-foreground">{names.length ? names.join(", ") : ".pem .crt .cer .key .p12 .pfx"}</span>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="cert-text">Or paste PEM</Label>
          <textarea id="cert-text" className={TEXT} rows={5} spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} placeholder="-----BEGIN CERTIFICATE-----" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="cert-pw">Password (PFX or encrypted key)</Label>
          <Input id="cert-pw" name="password" type="password" autoComplete="off" />
        </div>
        <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <SubmitButton pending={busy} disabled={!files.length && !text.trim()}>
            <PlusIcon />
            Add
          </SubmitButton>
        </div>
      </form>
    </Modal>
  )
}
const TEXT = "w-full rounded-md border border-input bg-transparent p-3 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"

function CertDialog({ projectId, id, role, onClose, onChanged }: { projectId: string; id: string; role: string; onClose: () => void; onChanged: () => void }) {
  const notify = useNotice()
  const { data: c, error, reload } = useLoad<Detail>(`/projects/${projectId}/certs/${id}`)
  const [dlError, setDlError] = useState<string | null>(null)
  const [pfx, setPfx] = useState(false)
  const [revoke, setRevoke] = useState(false)
  const [del, setDel] = useState(false)
  const [reason, setReason] = useState("0")
  const canWrite = role !== "viewer"
  const base = `/projects/${projectId}/certs/${id}`
  const save = async (format: string, password = "") => {
    setDlError(null)
    try {
      await downloadPost(`${base}/download`, { format, password }, `certificate.${format === "pfx" ? "pfx" : "pem"}`)
    } catch (e) {
      setDlError(errorText(e))
      throw e
    }
  }
  return (
    <Modal title={c?.name ?? "Certificate"} description={c ? c.subject : undefined} onClose={onClose} wide>
      <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
      {c && (
        <>
          <dl className="grid gap-3">
            <Row k="Status"><Expiry at={c.notAfter} revoked={Boolean(c.revokedAt)} />{c.revokedAt && <span className="ml-2 text-muted-foreground">{c.revokeReason}, {stamp.format(new Date(c.revokedAt))}</span>}</Row>
            <Row k="Names">{c.sans.length ? c.sans.join(", ") : "None"}</Row>
            <Row k="Issuer">{c.issuer}</Row>
            <Row k="Serial"><span className="font-mono text-xs">{c.serial}</span></Row>
            <Row k="Valid">{stamp.format(new Date(c.notBefore))} to {stamp.format(new Date(c.notAfter))}</Row>
            <Row k="Key type">{c.keyType}</Row>
            <Row k="Private key">
              {!c.hasKey ? "Not stored" : c.keyMatches ? (
                <span className="inline-flex items-center gap-1.5"><ShieldCheckIcon className="size-4 text-brand" weight="fill" />Stored, matches the certificate</span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-destructive"><WarningIcon className="size-4" weight="fill" />Stored, but does not match</span>
              )}
            </Row>
            <Row k="Fingerprint"><span className="font-mono text-xs break-all">{c.fingerprint}</span></Row>
            {c.chain.length > 0 && <Row k="Chain">{c.chain.map((x) => x.subject).join(" → ")}</Row>}
            {c.acme && <Row k="Let's Encrypt">{c.acme.domains.join(", ")} · {c.acme.challenge}</Row>}
          </dl>
          <div className="flex flex-wrap gap-2">
            {(
              [["cert", "Certificate"], ["fullchain", "Full chain"], ["chain", "Chain"]] as const
            ).map(([f, label]) => (
              <Button key={f} variant="outline" size="sm" disabled={f === "chain" && !c.chain.length} onClick={() => save(f).catch(() => {})}>
                <DownloadSimpleIcon />
                {label} (PEM)
              </Button>
            ))}
            {c.hasKey && canWrite && (
              <>
                <Button variant="outline" size="sm" onClick={() => save("key").catch(() => {})}>
                  <DownloadSimpleIcon />
                  Private key
                </Button>
                <Button variant="outline" size="sm" onClick={() => setPfx(true)}>
                  <DownloadSimpleIcon />
                  PFX
                </Button>
              </>
            )}
          </div>
          <p role="alert" className="text-sm text-destructive empty:hidden">{dlError}</p>
          {c.acme && c.acme.challenge !== "manual" && canWrite && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-primary" checked={c.acme.autoRenew} onChange={async (e) => { await api(base, "PATCH", { autoRenew: e.target.checked }).catch((er) => setDlError(errorText(er))); reload(); onChanged() }} />
              Renew automatically 30 days before it expires
            </label>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            {c.caId && !c.revokedAt && role === "admin" && <Button variant="outline" onClick={() => setRevoke(true)}>Revoke</Button>}
            {canWrite && <Button variant="outline" className="text-destructive" onClick={() => setDel(true)}>Delete</Button>}
          </div>
        </>
      )}
      {pfx && <PfxDialog onClose={() => setPfx(false)} run={(pw) => save("pfx", pw)} />}
      {revoke && (
        <Modal title="Revoke this certificate?" description="It goes onto the CA's revocation list at once. This can't be undone." onClose={() => setRevoke(false)}>
          <select aria-label="Reason" className={SELECT} value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="0">Unspecified</option>
            <option value="1">Key compromise</option>
            <option value="3">Affiliation changed</option>
            <option value="4">Superseded</option>
            <option value="5">Cessation of operation</option>
          </select>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRevoke(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={async () => {
                try {
                  await api(`${base}/revoke`, "POST", { reason: Number(reason) })
                  notify({ text: "Revoked." })
                  setRevoke(false)
                  reload()
                  onChanged()
                } catch (e) {
                  setDlError(errorText(e))
                  setRevoke(false)
                }
              }}
            >
              Revoke
            </Button>
          </div>
        </Modal>
      )}
      {del && (
        <Confirm
          title="Delete this certificate?"
          description="The certificate and its stored key are deleted for good. A revoked entry on a CA's list stays there."
          action="Delete"
          danger
          run={async () => {
            await api(base, "DELETE")
            onChanged()
            onClose()
          }}
          onClose={() => setDel(false)}
        />
      )}
    </Modal>
  )
}

function PfxDialog({ onClose, run }: { onClose: () => void; run: (pw: string) => Promise<void> }) {
  const { busy, error, setError, setBusy } = useBusy()
  return (
    <Modal title="Download as PFX" description="Choose a password for the file. It isn't stored." onClose={onClose}>
      <form
        className="grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          try {
            await run(String(new FormData(e.currentTarget).get("password")))
            onClose()
          } catch (er) {
            setError(errorText(er))
            setBusy(false)
          }
        }}
      >
        <Input name="password" type="password" aria-label="PFX password" autoComplete="new-password" minLength={4} required autoFocus />
        <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <SubmitButton pending={busy}>Download</SubmitButton>
        </div>
      </form>
    </Modal>
  )
}
