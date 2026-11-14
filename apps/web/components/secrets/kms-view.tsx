"use client"

import { ArrowsClockwiseIcon, CopyIcon, DotsThreeIcon, KeyIcon, PlusIcon, PowerIcon, TrashIcon } from "@phosphor-icons/react"
import { useState } from "react"

import { useLoad } from "@/components/secrets/access-view"
import { api, errorText } from "@/components/secrets/client"
import { Empty, TEXTAREA, stamp, useBusy } from "@/components/secrets/pki-ui"
import { Confirm, MenuButton, Modal, SELECT } from "@/components/secrets/ui"
import { SubmitButton } from "@/components/submit-button"
import { useNotice } from "@/components/toaster"
import { Button } from "@/components/ui/button"
import { GuideLink } from "@/components/secrets/guide-link"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

type Kind = "aes" | "ed25519" | "p256"
type Key = {
  id: string
  name: string
  kind: Kind
  state: "enabled" | "disabled"
  latest: number
  createdAt: string
  versions: { version: number; createdAt: string; publicKey: string | null }[]
}
const KIND: Record<Kind, string> = { aes: "AES-256-GCM", ed25519: "Ed25519", p256: "ECDSA P-256" }

const b64 = (t: string) => {
  let s = ""
  for (const b of new TextEncoder().encode(t)) s += String.fromCharCode(b)
  return btoa(s)
}
const unb64 = (t: string) => {
  const bin = atob(t)
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return `(binary, base64) ${t}`
  }
}

// Named keys for the project: encrypt/decrypt with AES, sign/verify with Ed25519 or P-256.
// Material never leaves the server; machine tokens call the same operations over REST.
export function KmsView({ projectId, role }: { projectId: string; role: string }) {
  const notify = useNotice()
  const { data, error, reload } = useLoad<{ keys: Key[] }>(`/projects/${projectId}/kms`)
  const [making, setMaking] = useState(false)
  const [confirm, setConfirm] = useState<{ key: Key; what: "delete" | "disable" } | null>(null)
  const [pub, setPub] = useState<Key | null>(null)
  const admin = role === "admin"
  const act = (k: Key, action: "rotate" | "enable" | "disable", done: string) =>
    api(`/projects/${projectId}/kms/${k.id}`, "POST", { action })
      .then(() => (notify({ text: done }), reload()))
      .catch((e) => notify({ text: errorText(e) }))
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold tracking-tight">KMS</h2>
        {admin && (
          <Button className="ml-auto" onClick={() => setMaking(true)}>
            <PlusIcon />
            New key
          </Button>
        )}
      </div>
      <p className="max-w-prose text-sm text-pretty text-muted-foreground">
        Named keys that Nimbus holds for you. Encrypt and decrypt with AES keys, sign and verify with Ed25519 or ECDSA keys. Rotating adds a version: new work uses it, old ciphertext and signatures still open. Every call is audited, never with the data. Machine tokens with a KMS scope reach the same keys over{" "}
        <code className="font-mono text-xs">/api/v1/secrets/kms</code>.
      </p>
      <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
      {!data ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : data.keys.length === 0 ? (
        <Empty icon={<KeyIcon />} title="No KMS keys yet">
          {admin ? "Make a key, then try it below." : "A project admin can make keys here."}{" "}
          <GuideLink to="kms">Use it from your apps</GuideLink>
        </Empty>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border">
          {data.keys.map((k) => (
            <li key={k.id} className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3", k.state === "disabled" && "opacity-60")}>
              <KeyIcon className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1 basis-48">
                <p className="truncate font-mono text-sm font-medium">{k.name}</p>
                <p className="text-xs text-muted-foreground">
                  {KIND[k.kind]} · version {k.latest} · made {stamp.format(new Date(k.createdAt))}
                  {k.state === "disabled" && " · disabled"}
                </p>
              </div>
              {admin && (
                <MenuButton
                  label={`Actions for ${k.name}`}
                  className="size-8"
                  trigger={<DotsThreeIcon weight="bold" className="size-5" />}
                  items={[
                    { label: "Rotate to a new version", icon: <ArrowsClockwiseIcon />, onClick: () => act(k, "rotate", `${k.name} is on version ${k.latest + 1}.`) },
                    ...(k.kind !== "aes" ? [{ label: "Show public key", icon: <CopyIcon />, onClick: () => setPub(k) }] : []),
                    k.state === "enabled"
                      ? { label: "Disable", icon: <PowerIcon />, onClick: () => setConfirm({ key: k, what: "disable" }) }
                      : { label: "Enable", icon: <PowerIcon />, onClick: () => act(k, "enable", `${k.name} is enabled.`) },
                    { label: "Delete", icon: <TrashIcon />, danger: true, separator: true, onClick: () => setConfirm({ key: k, what: "delete" }) },
                  ]}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {data && data.keys.length > 0 && <TryIt projectId={projectId} keys={data.keys} canAll={role !== "viewer"} />}
      {making && <NewKey projectId={projectId} onClose={() => setMaking(false)} onDone={reload} />}
      {pub && (
        <Modal title={`Public key of ${pub.name}`} description="Anyone can verify signatures with it. Older versions are listed too." onClose={() => setPub(null)}>
          {pub.versions.map((v) => (
            <div key={v.version} className="grid gap-1">
              <p className="text-xs text-muted-foreground">Version {v.version}</p>
              <pre className="overflow-x-auto rounded-md border bg-muted/30 p-3 font-mono text-xs">{v.publicKey}</pre>
            </div>
          ))}
        </Modal>
      )}
      {confirm && (
        <Confirm
          title={confirm.what === "delete" ? `Delete ${confirm.key.name}?` : `Disable ${confirm.key.name}?`}
          description={
            confirm.what === "delete"
              ? "Everything this key encrypted becomes unreadable and its signatures can't be checked. This can't be undone."
              : "Every operation with it, old versions too, is refused until you enable it again."
          }
          action={confirm.what === "delete" ? "Delete key" : "Disable"}
          danger={confirm.what === "delete"}
          run={async () => {
            if (confirm.what === "delete") await api(`/projects/${projectId}/kms/${confirm.key.id}`, "DELETE")
            else await api(`/projects/${projectId}/kms/${confirm.key.id}`, "POST", { action: "disable" })
            reload()
          }}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  )
}

function NewKey({ projectId, onClose, onDone }: { projectId: string; onClose: () => void; onDone: () => void }) {
  const { busy, error, setError, setBusy } = useBusy()
  return (
    <Modal title="New KMS key" onClose={onClose}>
      <form
        className="grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          setBusy(true)
          try {
            await api(`/projects/${projectId}/kms`, "POST", { name: f.get("name"), kind: f.get("kind") })
            onDone()
            onClose()
          } catch (er) {
            setError(errorText(er))
            setBusy(false)
          }
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor="kms-name">Name</Label>
          <Input id="kms-name" name="name" maxLength={64} required autoFocus placeholder="e.g. payments" className="font-mono" />
          <p className="text-xs text-muted-foreground">Letters, digits, dot, dash and underscore.</p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="kms-kind">Type</Label>
          <select id="kms-kind" name="kind" className={SELECT} defaultValue="aes">
            <option value="aes">AES-256-GCM (encrypt and decrypt)</option>
            <option value="ed25519">Ed25519 (sign and verify)</option>
            <option value="p256">ECDSA P-256 (sign and verify)</option>
          </select>
        </div>
        <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <SubmitButton pending={busy}>Create key</SubmitButton>
        </div>
      </form>
    </Modal>
  )
}

function TryIt({ projectId, keys, canAll }: { projectId: string; keys: Key[]; canAll: boolean }) {
  const usable = keys.filter((k) => k.state === "enabled")
  const [keyName, setKeyName] = useState(usable[0]?.name ?? "")
  const key = usable.find((k) => k.name === keyName) ?? usable[0]
  const ops = key?.kind === "aes" ? (["encrypt", "decrypt"] as const) : (["sign", "verify"] as const)
  const [op, setOp] = useState<string>("encrypt")
  const run = ops.includes(op as never) ? op : ops[0]
  const [input, setInput] = useState("")
  const [second, setSecond] = useState("")
  const [context, setContext] = useState("")
  const [out, setOut] = useState<{ text: string; ok?: boolean } | null>(null)
  const { busy, error, setError, setBusy } = useBusy()
  if (!key) return null
  const blocked = !canAll && run !== "verify"
  async function go() {
    setBusy(true)
    setError(null)
    setOut(null)
    try {
      const body: Record<string, string> = { op: run, key: key!.name }
      if (run === "encrypt" || run === "sign" || run === "verify") body.data = b64(input)
      if (run === "decrypt") body.ciphertext = input.trim()
      if (run === "verify") body.signature = second.trim()
      if (context && (run === "encrypt" || run === "decrypt")) body.context = context
      const r = await api<{ ciphertext?: string; data?: string; signature?: string; valid?: boolean; version: number }>(`/projects/${projectId}/kms/op`, "POST", body)
      if (r.ciphertext) setOut({ text: r.ciphertext })
      else if (r.signature) setOut({ text: r.signature })
      else if (r.data !== undefined) setOut({ text: unb64(r.data) })
      else setOut({ text: r.valid ? `Valid (key version ${r.version})` : "Not valid", ok: r.valid })
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-label="Try it" className="grid gap-4 rounded-xl border p-4">
      <h3 className="text-sm font-semibold">Try it</h3>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="grid gap-2">
          <Label htmlFor="try-key">Key</Label>
          <select id="try-key" className={SELECT} value={key.name} onChange={(e) => { setKeyName(e.target.value); setOut(null); setError(null) }}>
            {usable.map((k) => <option key={k.id} value={k.name}>{k.name}</option>)}
          </select>
        </div>
        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="try-op">Operation</Label>
          <select id="try-op" className={SELECT} value={run} onChange={(e) => { setOp(e.target.value); setOut(null); setError(null) }}>
            {ops.map((o) => <option key={o} value={o}>{o[0].toUpperCase() + o.slice(1)}</option>)}
          </select>
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="try-input">{run === "decrypt" ? "Ciphertext" : "Text"}</Label>
        <textarea id="try-input" rows={3} className={TEXTAREA} spellCheck={false} value={input} onChange={(e) => setInput(e.target.value)} placeholder={run === "decrypt" ? "nkms:v1:name:1:…" : "Anything, up to 1 MB"} />
      </div>
      {run === "verify" && (
        <div className="grid gap-2">
          <Label htmlFor="try-sig">Signature</Label>
          <textarea id="try-sig" rows={2} className={TEXTAREA} spellCheck={false} value={second} onChange={(e) => setSecond(e.target.value)} placeholder="nkms:v1:name:1:…" />
        </div>
      )}
      {(run === "encrypt" || run === "decrypt") && (
        <div className="grid gap-2">
          <Label htmlFor="try-ctx">Context (optional)</Label>
          <Input id="try-ctx" value={context} onChange={(e) => setContext(e.target.value)} placeholder="Must match on decrypt, e.g. order-1042" />
        </div>
      )}
      <div className="flex items-center gap-3">
        <SubmitButton type="button" pending={busy} disabled={blocked || !input} onClick={go}>
          {run[0].toUpperCase() + run.slice(1)}
        </SubmitButton>
        {blocked && <span className="text-xs text-muted-foreground">Viewers can only verify.</span>}
      </div>
      <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
      {out && (
        <pre role="status" className={cn("max-h-60 overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-xs break-all whitespace-pre-wrap", out.ok === true && "border-success/40 text-success", out.ok === false && "border-destructive/40 text-destructive")}>
          {out.text}
        </pre>
      )}
    </section>
  )
}
