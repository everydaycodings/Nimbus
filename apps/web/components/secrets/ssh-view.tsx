"use client"

import {
  CopyIcon,
  DownloadSimpleIcon,
  EyeIcon,
  KeyIcon,
  PencilSimpleIcon,
  PlusIcon,
  ShieldCheckIcon,
  TerminalWindowIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import dynamic from "next/dynamic"
import { useState } from "react"

import { useLoad } from "@/components/secrets/access-view"
import { api, copySecret, download, errorText } from "@/components/secrets/client"
import type { Detail } from "@/components/secrets/project-view"
import { CHECKBOX, Confirm, Modal, SELECT } from "@/components/secrets/ui"
import { SubmitButton } from "@/components/submit-button"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

const SshTerminal = dynamic(() => import("@/components/secrets/ssh-terminal").then((m) => m.SshTerminal), { ssr: false })

type Key = { id: string; name: string; kind: string; publicKey: string; fingerprint: string; comment: string | null; hasPassphrase: boolean; createdAt: string }
type Host = { id: string; name: string; host: string; port: number; username: string; keyId: string | null; useCa: boolean; jumpHostId: string | null; pinned: boolean }
type Cert = { id: string; serial: number; keyId: string; principals: string; fingerprint: string; expiresAt: string; createdAt: string; by: string | null; current: boolean }
type CaData = { ca: { publicKey: string; fingerprint: string; createdAt: string; rotatedAt: string | null; script: string } | null; certs: Cert[] }

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
const TABS = [
  ["keys", "Keys"],
  ["hosts", "Hosts"],
  ["ca", "SSH CA"],
] as const

const TEXTAREA =
  "min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"

export function SshView({ detail }: { detail: Detail }) {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("keys")
  return (
    <div className="flex flex-col gap-5">
      <div role="tablist" aria-label="SSH" className="flex gap-1 overflow-x-auto border-b">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            id={`ssh-tab-${id}`}
            aria-selected={tab === id}
            aria-controls="ssh-panel"
            onClick={() => setTab(id)}
            className={cn(
              "-mb-px h-9 shrink-0 border-b-2 px-3 text-sm whitespace-nowrap outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              tab === id ? "border-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div id="ssh-panel" role="tabpanel" aria-labelledby={`ssh-tab-${tab}`}>
        {tab === "keys" ? <Keys detail={detail} /> : tab === "hosts" ? <Hosts detail={detail} /> : <Ca detail={detail} />}
      </div>
    </div>
  )
}

const Intro = ({ children }: { children: React.ReactNode }) => (
  <p className="max-w-prose flex-1 text-sm text-pretty text-muted-foreground">{children}</p>
)

// ---------- keys ----------

function Keys({ detail }: { detail: Detail }) {
  const base = `/projects/${detail.id}/ssh/keys`
  const { data, error, reload } = useLoad<{ keys: Key[]; can: { use: boolean; admin: boolean } }>(base)
  const [add, setAdd] = useState(false)
  const [reveal, setReveal] = useState<Key | null>(null)
  const [rename, setRename] = useState<Key | null>(null)
  const [drop, setDrop] = useState<Key | null>(null)
  const [note, setNote] = useState<string | null>(null)
  if (!data) return <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
  const { can } = data
  return (
    <section className="flex flex-col gap-3" aria-label="SSH keys">
      <div className="flex flex-wrap items-center gap-3">
        <Intro>
          Private keys are sealed with this project&apos;s key. Viewers see public keys only. Revealing or downloading a private key is written to the audit log.
        </Intro>
        {can.use && (
          <Button onClick={() => setAdd(true)}>
            <PlusIcon />
            Add key
          </Button>
        )}
      </div>
      <p role="status" className="text-sm text-muted-foreground empty:hidden">{note}</p>
      {data.keys.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">No keys yet. Generate one here or import one you already use.</p>
      ) : (
        <ul className="divide-y rounded-xl border" data-testid="ssh-keys">
          {data.keys.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
              <KeyIcon className="size-5 shrink-0 text-muted-foreground" />
              <div className="grid min-w-0 flex-1 basis-56 gap-0.5">
                <p className="truncate text-sm font-medium">
                  {k.name}{" "}
                  <span className="ml-1 rounded border px-1.5 py-0.5 text-xs font-normal text-muted-foreground">{k.kind}</span>
                  {k.hasPassphrase && <span className="ml-1 rounded border px-1.5 py-0.5 text-xs font-normal text-muted-foreground">passphrase</span>}
                </p>
                <p className="truncate font-mono text-xs text-muted-foreground" title={k.fingerprint}>{k.fingerprint}</p>
                {k.comment && <p className="truncate text-xs text-muted-foreground">{k.comment}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(k.publicKey).then(() => setNote(`Copied the public key of ${k.name}.`))}>
                  <CopyIcon />
                  Public key
                </Button>
                <Button variant="ghost" size="sm" onClick={() => download(`${k.name.replace(/\W+/g, "_")}.pub`, k.publicKey + "\n")}>
                  <DownloadSimpleIcon />
                  .pub
                </Button>
                {can.use && (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => setReveal(k)}>
                      <EyeIcon />
                      Private key
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`Rename ${k.name}`} onClick={() => setRename(k)}>
                      <PencilSimpleIcon />
                    </Button>
                  </>
                )}
                {can.admin && (
                  <Button variant="ghost" size="icon-sm" aria-label={`Delete ${k.name}`} onClick={() => setDrop(k)}>
                    <TrashIcon />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {add && <AddKey base={base} onClose={() => setAdd(false)} onDone={() => (setAdd(false), reload())} />}
      {reveal && <RevealKey base={base} k={reveal} onClose={() => setReveal(null)} />}
      {rename && <RenameKey base={base} k={rename} onClose={() => setRename(null)} onDone={() => (setRename(null), reload())} />}
      {drop && (
        <Confirm
          title={`Delete ${drop.name}?`}
          description="The private key is deleted for good. Hosts and server pushes that use it will need another key."
          action="Delete"
          danger
          run={async () => {
            await api(`${base}/${drop.id}`, "DELETE")
            reload()
          }}
          onClose={() => setDrop(null)}
        />
      )}
    </section>
  )
}

function AddKey({ base, onClose, onDone }: { base: string; onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<"generate" | "import">("generate")
  const [text, setText] = useState("")
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <Modal title="Add an SSH key" onClose={onClose}>
      <form
        className="grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          setBusy(true)
          setErr(null)
          try {
            await api(
              base,
              "POST",
              mode === "generate"
                ? { mode, name: f.get("name"), kind: f.get("kind"), comment: String(f.get("comment") ?? "") || undefined, passphrase: String(f.get("passphrase") ?? "") || undefined }
                : { mode, name: f.get("name"), privateKey: text, passphrase: String(f.get("passphrase") ?? "") || undefined }
            )
            onDone()
          } catch (x) {
            setErr(errorText(x))
          }
          setBusy(false)
        }}
      >
        <div role="radiogroup" aria-label="How" className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-sm">
          {(["generate", "import"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={cn("h-8 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50", mode === m ? "bg-background font-medium shadow-sm" : "text-muted-foreground")}
            >
              {m === "generate" ? "Generate in Nimbus" : "Import"}
            </button>
          ))}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="key-name">Name</Label>
          <Input id="key-name" name="name" placeholder="deploy key" required maxLength={60} />
        </div>
        {mode === "generate" ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="key-kind">Type</Label>
                <select id="key-kind" name="kind" className={SELECT} defaultValue="ed25519">
                  <option value="ed25519">ed25519 (recommended)</option>
                  <option value="rsa">RSA 4096 (slow to make)</option>
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="key-comment">Comment</Label>
                <Input id="key-comment" name="comment" placeholder="you@nimbus" maxLength={100} />
              </div>
            </div>
          </>
        ) : (
          <div className="grid gap-2">
            <Label htmlFor="key-pem">Private key</Label>
            <textarea id="key-pem" rows={6} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} autoComplete="off" required placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" className={TEXTAREA} />
            <input
              type="file"
              aria-label="Or upload a key file"
              className="text-xs"
              onChange={async (e) => {
                const f = e.target.files?.[0]
                if (f && f.size < 20_000) setText(await f.text())
              }}
            />
          </div>
        )}
        <div className="grid gap-2">
          <Label htmlFor="key-pass">Passphrase (optional)</Label>
          <Input id="key-pass" name="passphrase" type="password" autoComplete="new-password" maxLength={200} />
          <p className="text-xs text-muted-foreground">
            {mode === "generate" ? "Encrypts the key itself. Nimbus stores the passphrase sealed and uses it for pushes and the terminal." : "Needed only if the key is encrypted."}
          </p>
        </div>
        <p role="alert" className="text-sm text-destructive empty:hidden">{err}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <SubmitButton pending={busy}>{mode === "generate" ? "Generate" : "Import"}</SubmitButton>
        </div>
      </form>
    </Modal>
  )
}

function RevealKey({ base, k, onClose }: { base: string; k: Key; onClose: () => void }) {
  const [data, setData] = useState<{ privateKey: string; passphrase: string | null } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  return (
    <Modal title={`Private key: ${k.name}`} description="Showing it is recorded in the audit log." onClose={onClose}>
      {!data ? (
        <div className="grid gap-3">
          <p role="alert" className="text-sm text-destructive empty:hidden">{err}</p>
          <Button
            onClick={async () => {
              try {
                setData(await api(`${base}/${k.id}`))
              } catch (e) {
                setErr(errorText(e))
              }
            }}
          >
            <EyeIcon />
            Reveal private key
          </Button>
        </div>
      ) : (
        <div className="grid gap-3">
          <textarea readOnly rows={8} value={data.privateKey} aria-label="Private key" className={TEXTAREA} data-testid="private-key" />
          {data.passphrase && (
            <p className="text-sm">
              Passphrase: <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs" data-testid="passphrase">{data.passphrase}</code>
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => copySecret(data.privateKey)}>
              <CopyIcon />
              Copy
            </Button>
            <Button variant="outline" onClick={() => download(`id_${k.name.replace(/\W+/g, "_")}`, data.privateKey)}>
              <DownloadSimpleIcon />
              Download
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function RenameKey({ base, k, onClose, onDone }: { base: string; k: Key; onClose: () => void; onDone: () => void }) {
  const [err, setErr] = useState<string | null>(null)
  return (
    <Modal title="Rename key" onClose={onClose}>
      <form
        className="grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault()
          try {
            await api(`${base}/${k.id}`, "PATCH", { name: new FormData(e.currentTarget).get("name") })
            onDone()
          } catch (x) {
            setErr(errorText(x))
          }
        }}
      >
        <Input name="name" defaultValue={k.name} aria-label="Name" required maxLength={60} />
        <p role="alert" className="text-sm text-destructive empty:hidden">{err}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <SubmitButton>Save</SubmitButton>
        </div>
      </form>
    </Modal>
  )
}

// ---------- hosts ----------

function Hosts({ detail }: { detail: Detail }) {
  const base = `/projects/${detail.id}/ssh`
  const hosts = useLoad<{ hosts: Host[] }>(`${base}/hosts`)
  const keys = useLoad<{ keys: Key[]; can: { use: boolean } }>(`${base}/keys`)
  const ca = useLoad<CaData>(`${base}/ca`)
  const [edit, setEdit] = useState<Host | "new" | null>(null)
  const [drop, setDrop] = useState<Host | null>(null)
  const [term, setTerm] = useState<Host | null>(null)
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null)
  if (!hosts.data || !keys.data) return <p role="alert" className="text-sm text-destructive empty:hidden">{hosts.error ?? keys.error}</p>
  const can = keys.data.can.use
  const keyName = (id: string | null) => keys.data!.keys.find((k) => k.id === id)?.name
  const config = async (host?: string) => {
    try {
      const res = await fetch(`/api/v1/secrets${base}/config${host ? `?host=${host}` : ""}`, { cache: "no-store" })
      if (!res.ok) throw new Error("Couldn't build the config.")
      return await res.text()
    } catch (e) {
      setNote({ text: errorText(e), error: true })
      return null
    }
  }
  return (
    <section className="flex flex-col gap-3" aria-label="SSH hosts">
      <div className="flex flex-wrap items-center gap-3">
        <Intro>Saved hosts: sign in with a stored key or a certificate from the project&apos;s CA, open a terminal here in the browser, or export a ~/.ssh/config block.</Intro>
        <Button
          variant="outline"
          disabled={hosts.data.hosts.length === 0}
          onClick={async () => {
            const t = await config()
            if (t) {
              download("ssh_config", t)
              setNote({ text: "Downloaded the config for every host." })
            }
          }}
        >
          <DownloadSimpleIcon />
          Export config
        </Button>
        {can && (
          <Button onClick={() => setEdit("new")}>
            <PlusIcon />
            Add host
          </Button>
        )}
      </div>
      <p role="status" className={cn("text-sm empty:hidden", note?.error ? "text-destructive" : "text-muted-foreground")}>{note?.text}</p>
      {hosts.data.hosts.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">No hosts yet.</p>
      ) : (
        <ul className="divide-y rounded-xl border" data-testid="ssh-hosts">
          {hosts.data.hosts.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
              <TerminalWindowIcon className="size-5 shrink-0 text-muted-foreground" />
              <div className="grid min-w-0 flex-1 basis-56 gap-0.5">
                <p className="truncate text-sm font-medium">{h.name}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {h.username}@{h.host}
                  {h.port !== 22 ? `:${h.port}` : ""}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {h.useCa ? "SSH CA certificate" : `Key: ${keyName(h.keyId) ?? "deleted"}`}
                  {h.jumpHostId && ` · via ${hosts.data!.hosts.find((x) => x.id === h.jumpHostId)?.name ?? "jump host"}`}
                  {h.pinned && " · host key pinned"}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {can && (
                  <Button variant="outline" size="sm" onClick={() => setTerm(h)}>
                    <TerminalWindowIcon />
                    Terminal
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    const t = await config(h.id)
                    if (t) {
                      await navigator.clipboard.writeText(t)
                      setNote({ text: `Copied the ssh config for ${h.name}.` })
                    }
                  }}
                >
                  <CopyIcon />
                  Config
                </Button>
                {can && (
                  <>
                    <Button variant="ghost" size="icon-sm" aria-label={`Edit ${h.name}`} onClick={() => setEdit(h)}>
                      <PencilSimpleIcon />
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`Delete ${h.name}`} onClick={() => setDrop(h)}>
                      <TrashIcon />
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {edit && (
        <HostForm
          base={base}
          host={edit === "new" ? null : edit}
          hosts={hosts.data.hosts}
          keys={keys.data.keys}
          hasCa={Boolean(ca.data?.ca)}
          onClose={() => setEdit(null)}
          onDone={() => (setEdit(null), hosts.reload())}
        />
      )}
      {drop && (
        <Confirm
          title={`Remove ${drop.name}?`}
          description="Only the saved entry goes. The server and its keys are untouched."
          action="Remove"
          danger
          run={async () => {
            await api(`${base}/hosts/${drop.id}`, "DELETE")
            hosts.reload()
          }}
          onClose={() => setDrop(null)}
        />
      )}
      {term && <SshTerminal projectId={detail.id} host={term} onClose={() => (setTerm(null), hosts.reload())} />}
    </section>
  )
}

function HostForm({
  base,
  host,
  hosts,
  keys,
  hasCa,
  onClose,
  onDone,
}: {
  base: string
  host: Host | null
  hosts: Host[]
  keys: Key[]
  hasCa: boolean
  onClose: () => void
  onDone: () => void
}) {
  const [auth, setAuth] = useState<string>(host?.useCa ? "ca" : (host?.keyId ?? keys[0]?.id ?? (hasCa ? "ca" : "")))
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <Modal title={host ? `Edit ${host.name}` : "Add a host"} onClose={onClose}>
      <form
        className="grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          setBusy(true)
          setErr(null)
          const body = {
            name: f.get("name"),
            host: f.get("host"),
            port: Number(f.get("port")),
            username: f.get("username"),
            useCa: auth === "ca",
            keyId: auth === "ca" ? null : auth,
            jumpHostId: String(f.get("jump") ?? "") || null,
            forgetHostKey: f.get("forget") === "on",
          }
          try {
            if (host) await api(`${base}/hosts/${host.id}`, "PUT", body)
            else await api(`${base}/hosts`, "POST", body)
            onDone()
          } catch (x) {
            setErr(errorText(x))
          }
          setBusy(false)
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor="host-name">Name</Label>
          <Input id="host-name" name="name" defaultValue={host?.name} placeholder="web-1" required maxLength={60} />
        </div>
        <div className="grid gap-4 sm:grid-cols-[1fr_6rem]">
          <div className="grid gap-2">
            <Label htmlFor="host-host">Host</Label>
            <Input id="host-host" name="host" defaultValue={host?.host} placeholder="web1.example.com" required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="host-port">Port</Label>
            <Input id="host-port" name="port" type="number" defaultValue={host?.port ?? 22} min={1} max={65535} required />
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="host-user">User</Label>
          <Input id="host-user" name="username" defaultValue={host?.username} placeholder="deploy" required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="host-auth">Sign in with</Label>
          <select id="host-auth" className={SELECT} value={auth} onChange={(e) => setAuth(e.target.value)} required>
            {keys.length === 0 && !hasCa && <option value="">Add a key or set up the CA first</option>}
            {keys.map((k) => (
              <option key={k.id} value={k.id}>Key: {k.name}</option>
            ))}
            {hasCa && <option value="ca">A certificate from the SSH CA (the user name is the principal)</option>}
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="host-jump">Jump host (optional)</Label>
          <select id="host-jump" name="jump" className={SELECT} defaultValue={host?.jumpHostId ?? ""}>
            <option value="">None</option>
            {hosts.filter((h) => h.id !== host?.id && !h.jumpHostId).map((h) => (
              <option key={h.id} value={h.id}>{h.name}</option>
            ))}
          </select>
        </div>
        {host?.pinned && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="forget" className={CHECKBOX} />
            Trust a new host key
          </label>
        )}
        <p role="alert" className="text-sm text-destructive empty:hidden">{err}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <SubmitButton pending={busy}>{host ? "Save" : "Add host"}</SubmitButton>
        </div>
      </form>
    </Modal>
  )
}

// ---------- CA ----------

function Ca({ detail }: { detail: Detail }) {
  const base = `/projects/${detail.id}/ssh/ca`
  const { data, error, reload } = useLoad<CaData>(base)
  const keys = useLoad<{ keys: Key[]; can: { use: boolean; admin: boolean } }>(`/projects/${detail.id}/ssh/keys`)
  const [issue, setIssue] = useState(false)
  const [rotate, setRotate] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  if (!data || !keys.data) return <p role="alert" className="text-sm text-destructive empty:hidden">{error ?? keys.error}</p>
  const { can } = keys.data
  const ca = data.ca
  if (!ca)
    return (
      <section className="flex flex-col gap-3" aria-label="SSH CA">
        <Intro>
          A certificate authority for this project signs short-lived SSH certificates (1 to 8 hours) so servers trust one CA key instead of a list of people&apos;s keys. The CA key never leaves Nimbus.
        </Intro>
        <p role="alert" className="text-sm text-destructive empty:hidden">{err}</p>
        {can.admin ? (
          <Button
            className="w-fit"
            onClick={async () => {
              try {
                await api(base, "POST", {})
                reload()
              } catch (e) {
                setErr(errorText(e))
              }
            }}
          >
            <ShieldCheckIcon />
            Set up the SSH CA
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">A project admin can set it up.</p>
        )}
      </section>
    )
  return (
    <section className="flex flex-col gap-5" aria-label="SSH CA">
      <div className="flex flex-wrap items-center gap-3">
        <Intro>Servers that trust this CA accept any certificate it signs, for the principals in the certificate.</Intro>
        {can.use && (
          <Button onClick={() => setIssue(true)}>
            <ShieldCheckIcon />
            Issue certificate
          </Button>
        )}
      </div>
      <div className="grid gap-3 rounded-xl border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="basis-full text-sm font-medium sm:flex-1 sm:basis-auto">CA public key</h2>
          <Button variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(ca.publicKey)}>
            <CopyIcon />
            Copy
          </Button>
          <Button variant="ghost" size="sm" onClick={() => download("nimbus_ca.pub", ca.publicKey + "\n")}>
            <DownloadSimpleIcon />
            .pub
          </Button>
          {can.admin && (
            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setRotate(true)}>
              Rotate
            </Button>
          )}
        </div>
        <p className="font-mono text-xs break-all text-muted-foreground" data-testid="ca-public">{ca.publicKey}</p>
        <p className="text-xs text-muted-foreground">
          {ca.fingerprint} · created {when(ca.createdAt)}
          {ca.rotatedAt && ` · rotated ${when(ca.rotatedAt)}`}
        </p>
      </div>
      <div className="grid gap-2 rounded-xl border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="basis-full text-sm font-medium sm:flex-1 sm:basis-auto">Set up a server to trust it</h2>
          <Button variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(ca.script)}>
            <CopyIcon />
            Copy script
          </Button>
          <Button variant="ghost" size="sm" onClick={() => download("trust-nimbus-ca.sh", ca.script)}>
            <DownloadSimpleIcon />
            Download
          </Button>
        </div>
        <pre className="overflow-x-auto rounded-md bg-muted/50 p-3 font-mono text-xs" data-testid="ca-script">{ca.script}</pre>
        <p className="text-xs text-muted-foreground">
          Run it as root on the server. To limit who may log in as which account, add <code>AuthorizedPrincipalsFile /etc/ssh/principals/%u</code> and list the allowed principals in that file.
        </p>
      </div>
      <div className="grid gap-2">
        <h2 className="text-sm font-medium">Issued certificates</h2>
        {data.certs.length === 0 ? (
          <p className="text-sm text-muted-foreground">None yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-left text-sm" data-testid="cert-log">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="p-2 font-medium">Serial</th>
                  <th className="p-2 font-medium">Key id</th>
                  <th className="p-2 font-medium">Principals</th>
                  <th className="p-2 font-medium">Issued</th>
                  <th className="p-2 font-medium">Expires</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.certs.map((c) => (
                  <tr key={c.id}>
                    <td className="p-2 tabular-nums">{c.serial}</td>
                    <td className="p-2">{c.keyId}</td>
                    <td className="p-2 font-mono text-xs">{c.principals}</td>
                    <td className="p-2 whitespace-nowrap">{when(c.createdAt)}{c.by ? ` by ${c.by}` : ""}</td>
                    <td className="p-2 whitespace-nowrap">
                      {when(c.expiresAt)}
                      {!c.current && <span className="ml-2 rounded border px-1.5 py-0.5 text-xs text-muted-foreground">old CA</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {issue && <Issue base={base} onClose={() => setIssue(false)} onDone={reload} />}
      {rotate && (
        <Confirm
          title="Rotate the CA key?"
          description="Servers must trust the new public key. Certificates signed by the old key stop working there."
          action="Rotate"
          danger
          run={async () => {
            await api(base, "POST", { rotate: true })
            reload()
          }}
          onClose={() => setRotate(false)}
        />
      )}
    </section>
  )
}

type Issued = { certificate: string; expiresAt: string; serial: number; principals: string[]; keyId: string; privateKey: string | null }

function Issue({ base, onClose, onDone }: { base: string; onClose: () => void; onDone: () => void }) {
  const [own, setOwn] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<Issued | null>(null)
  if (res)
    return (
      <Modal title="Certificate issued" description={`Serial ${res.serial} for ${res.keyId}, valid until ${when(res.expiresAt)}.`} onClose={onClose} wide>
        <div className="grid gap-3">
          <Label htmlFor="cert-out">Certificate (save as <code>id_nimbus-cert.pub</code>)</Label>
          <textarea id="cert-out" readOnly rows={4} value={res.certificate} className={TEXTAREA} data-testid="cert-out" />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => navigator.clipboard.writeText(res.certificate)}>
              <CopyIcon />
              Copy
            </Button>
            <Button variant="outline" onClick={() => download("id_nimbus-cert.pub", res.certificate + "\n")}>
              <DownloadSimpleIcon />
              Download
            </Button>
          </div>
          {res.privateKey && (
            <>
              <Label htmlFor="cert-key">New private key (shown once, save as <code>id_nimbus</code>)</Label>
              <textarea id="cert-key" readOnly rows={5} value={res.privateKey} className={TEXTAREA} data-testid="cert-key" />
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => copySecret(res.privateKey!)}>
                  <CopyIcon />
                  Copy
                </Button>
                <Button variant="outline" onClick={() => download("id_nimbus", res.privateKey!)}>
                  <DownloadSimpleIcon />
                  Download
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Connect with <code>ssh -i id_nimbus -o CertificateFile=id_nimbus-cert.pub user@host</code>
              </p>
            </>
          )}
        </div>
      </Modal>
    )
  return (
    <Modal title="Issue a certificate" description="Signed for you: the key id is your email." onClose={onClose}>
      <form
        className="grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          setBusy(true)
          setErr(null)
          try {
            const r = await api<Issued>(`${base}/issue`, "POST", {
              principals: String(f.get("principals")).split(/[\s,]+/).filter(Boolean),
              hours: Number(f.get("hours")),
              publicKey: own ? String(f.get("publicKey") ?? "").trim() : undefined,
            })
            setRes(r)
            onDone()
          } catch (x) {
            setErr(errorText(x))
          }
          setBusy(false)
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor="cert-principals">Principals</Label>
          <Input id="cert-principals" name="principals" placeholder="deploy, root" required />
          <p className="text-xs text-muted-foreground">The accounts it may log in as, separated by commas.</p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="cert-hours">Valid for</Label>
          <select id="cert-hours" name="hours" className={SELECT} defaultValue="1">
            {[1, 2, 4, 8].map((h) => (
              <option key={h} value={h}>{h} hour{h > 1 ? "s" : ""}</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className={CHECKBOX} checked={own} onChange={(e) => setOwn(e.target.checked)} />
          Sign a public key I paste (otherwise Nimbus makes a new key pair)
        </label>
        {own && (
          <div className="grid gap-2">
            <Label htmlFor="cert-pub">Public key</Label>
            <textarea id="cert-pub" name="publicKey" rows={3} required spellCheck={false} placeholder="ssh-ed25519 AAAA…" className={TEXTAREA} />
          </div>
        )}
        <p role="alert" className="text-sm text-destructive empty:hidden">{err}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <SubmitButton pending={busy}>Issue</SubmitButton>
        </div>
      </form>
    </Modal>
  )
}
