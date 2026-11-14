"use client"

import { PaperPlaneTiltIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react"
import { useState } from "react"

import { useLoad } from "@/components/secrets/access-view"
import { api, copySecret, errorText } from "@/components/secrets/client"
import { Empty } from "@/components/secrets/pki-ui"
import type { Detail } from "@/components/secrets/project-view"
import { CHECKBOX, Confirm, Modal, SELECT } from "@/components/secrets/ui"
import { SubmitButton } from "@/components/submit-button"
import { Button } from "@/components/ui/button"
import { GuideLink } from "@/components/secrets/guide-link"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })

// Per environment: push the .env to a server, and tell other systems when keys change.
export function IntegrationsView({ detail, kind }: { detail: Detail; kind: "push" | "webhooks" }) {
  const [envId, setEnvId] = useState(detail.envs[0]?.id ?? "")
  return (
    <section className="flex flex-col gap-4" aria-label={kind === "push" ? "Server push" : "Webhooks"}>
      <div className="flex flex-wrap items-center gap-3">
        <p className="max-w-prose flex-1 basis-72 text-sm text-pretty text-muted-foreground">
          {kind === "push"
            ? "Writes this environment's .env to a server over SSH (owner-only file, replaced in one step) and can run a command after, like restarting the app. Pushes happen on demand and again whenever a secret here changes."
            : "Sends a signed POST when a secret here changes. It names the project, the environment and the keys that changed, never their values."}{" "}
          <GuideLink to={kind === "push" ? "server-push-over-ssh" : "webhooks"}>{kind === "push" ? "How server push works" : "Verify the signature"}</GuideLink>
        </p>
        <div className="grid gap-1">
          <Label htmlFor="int-env" className="text-xs text-muted-foreground">Environment</Label>
          <select id="int-env" className={cn(SELECT, "w-44")} value={envId} onChange={(e) => setEnvId(e.target.value)}>
            {detail.envs.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </div>
      </div>
      {envId && (kind === "push" ? <Push key={envId} detail={detail} envId={envId} /> : <Webhooks key={envId} detail={detail} envId={envId} />)}
    </section>
  )
}

type PushCfg = {
  keyId: string | null
  host: string
  port: number
  username: string
  path: string
  postCommand: string
  auto: boolean
  hostKey: string | null
  via: string | null
  lastAt: string | null
  lastOk: boolean | null
  lastMessage: string | null
}

function Push({ detail, envId }: { detail: Detail; envId: string }) {
  const base = `/projects/${detail.id}/envs/${envId}/push`
  const { data, error, reload } = useLoad<{ push: PushCfg | null }>(base)
  const storedKeys = useLoad<{ keys: { id: string; name: string }[] }>(`/projects/${detail.id}/ssh/keys`)
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null)
  const [busy, setBusy] = useState<"save" | "run" | null>(null)
  const [drop, setDrop] = useState(false)
  if (!data) return <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
  const p = data.push
  return (
    <div className="flex flex-col gap-4">
      <form
        key={p?.host ?? "new"}
        className="grid gap-4 rounded-xl border p-4"
        onSubmit={async (e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          setBusy("save")
          setNote(null)
          try {
            await api(base, "PUT", {
              host: f.get("host"),
              port: Number(f.get("port")),
              username: f.get("username"),
              path: f.get("path"),
              privateKey: String(f.get("privateKey") ?? "") || undefined,
              keyId: String(f.get("keyId") ?? "") || undefined,
              postCommand: f.get("postCommand"),
              auto: f.get("auto") === "on",
              forgetHostKey: f.get("forget") === "on",
            })
            setNote({ text: "Saved." })
            await reload()
          } catch (err) {
            setNote({ text: errorText(err), error: true })
          }
          setBusy(null)
        }}
      >
        <div className="grid gap-4 sm:grid-cols-[1fr_6rem_1fr]">
          <div className="grid gap-2">
            <Label htmlFor="push-host">Host</Label>
            <Input id="push-host" name="host" defaultValue={p?.host} placeholder="app.example.com" required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="push-port">Port</Label>
            <Input id="push-port" name="port" type="number" defaultValue={p?.port ?? 22} min={1} max={65535} required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="push-user">User</Label>
            <Input id="push-user" name="username" defaultValue={p?.username} placeholder="deploy" required />
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="push-path">File on the server</Label>
          <Input id="push-path" name="path" defaultValue={p?.path} placeholder="/srv/app/.env" className="font-mono" required />
        </div>
        {storedKeys.data && storedKeys.data.keys.length > 0 && (
          <div className="grid gap-2">
            <Label htmlFor="push-stored">Stored SSH key</Label>
            <select id="push-stored" name="keyId" className={SELECT} defaultValue={p?.keyId ?? ""}>
              <option value="">{p && !p.keyId ? "Use the key pasted below" : "None: paste a key below"}</option>
              {storedKeys.data.keys.map((k) => (
                <option key={k.id} value={k.id}>{k.name}</option>
              ))}
            </select>
          </div>
        )}
        <div className="grid gap-2">
          <Label htmlFor="push-key">Private key</Label>
          <textarea
            id="push-key"
            name="privateKey"
            rows={4}
            spellCheck={false}
            autoComplete="off"
            placeholder={p ? "Stored, sealed with this project's key. Paste a new one to replace it." : "-----BEGIN OPENSSH PRIVATE KEY-----"}
            className="min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
          />
          <p className="text-xs text-muted-foreground">Without a passphrase. Use a key that can only write this file.</p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="push-cmd">Run after writing (optional)</Label>
          <Input id="push-cmd" name="postCommand" defaultValue={p?.postCommand} placeholder="systemctl restart app" className="font-mono" />
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="auto" className={CHECKBOX} defaultChecked={p?.auto} />
            Push again whenever a secret here changes
          </label>
          {p?.hostKey && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="forget" className={CHECKBOX} />
              Trust a new host key
            </label>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SubmitButton pending={busy === "save"}>{p ? "Save changes" : "Set up push"}</SubmitButton>
          {p && (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={busy !== null}
                onClick={async () => {
                  setBusy("run")
                  setNote(null)
                  try {
                    const r = await api<{ message: string }>(base, "POST")
                    setNote({ text: r.message })
                  } catch (err) {
                    setNote({ text: errorText(err), error: true })
                  }
                  await reload()
                  setBusy(null)
                }}
              >
                <PaperPlaneTiltIcon />
                {busy === "run" ? "Pushing…" : "Push now"}
              </Button>
              <Button type="button" variant="ghost" className="text-destructive" onClick={() => setDrop(true)}>
                Remove
              </Button>
            </>
          )}
          <p role="status" className={cn("text-sm", note?.error ? "text-destructive" : "text-muted-foreground")}>{note?.text}</p>
        </div>
      </form>
      {p?.via && (
        <p className="text-sm text-muted-foreground" data-testid="push-via">
          Goes through the jump host {p.via}, set on this host&rsquo;s entry in the SSH tab.
        </p>
      )}
      {p?.lastAt && (
        <p className="text-sm text-muted-foreground" data-testid="push-last">
          Last push {when(p.lastAt)}: <span className={p.lastOk ? undefined : "text-destructive"}>{p.lastMessage}</span>
        </p>
      )}
      {drop && (
        <Confirm
          title="Remove server push?"
          description="Nimbus forgets the host and the stored key. The file already on the server stays."
          action="Remove"
          danger
          run={async () => {
            await api(base, "DELETE")
            reload()
          }}
          onClose={() => setDrop(false)}
        />
      )}
    </div>
  )
}

type Hooks = {
  hooks: { id: string; url: string; enabled: boolean }[]
  deliveries: { id: string; webhookId: string; event: string; status: string; httpStatus: number | null; message: string | null; attempts: number; at: string; keys: string[] }[]
}

function Webhooks({ detail, envId }: { detail: Detail; envId: string }) {
  const base = `/projects/${detail.id}/envs/${envId}/webhooks`
  const { data, error, reload } = useLoad<Hooks>(base)
  const [url, setUrl] = useState("")
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [drop, setDrop] = useState<string | null>(null)
  const act = async (fn: () => Promise<unknown>) => {
    setNote(null)
    try {
      await fn()
    } catch (e) {
      setNote({ text: errorText(e), error: true })
    }
    await reload()
  }
  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          act(async () => {
            const r = await api<{ secret: string }>(base, "POST", { url })
            setSecret(r.secret)
            setUrl("")
          })
        }}
      >
        <Input aria-label="Webhook URL" type="url" placeholder="https://example.com/hooks/nimbus" value={url} onChange={(e) => setUrl(e.target.value)} required />
        <Button type="submit" variant="outline">
          <PlusIcon />
          Add webhook
        </Button>
      </form>
      <p role="alert" className="text-sm text-destructive empty:hidden">{error ?? (note?.error ? note.text : null)}</p>
      <p role="status" className="text-sm text-muted-foreground empty:hidden">{note && !note.error ? note.text : null}</p>
      <ul className="flex flex-col divide-y rounded-xl border empty:hidden">
        {data?.hooks.map((h) => (
          <li key={h.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
            <span className={cn("min-w-0 flex-1 basis-56 truncate font-mono text-sm", !h.enabled && "opacity-60")}>{h.url}</span>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className={CHECKBOX}
                checked={h.enabled}
                onChange={(e) => act(() => api(`${base}/${h.id}`, "PATCH", { enabled: e.target.checked }))}
              />
              On
            </label>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                act(async () => {
                  const r = await api<{ status: string; httpStatus: number | null; message: string | null }>(`${base}/${h.id}/test`, "POST")
                  setNote(r.status === "delivered" ? { text: `Test delivered (${r.httpStatus}).` } : { text: r.message ?? "Test failed.", error: true })
                })
              }
            >
              Test
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label={`Remove ${h.url}`} onClick={() => setDrop(h.id)}>
              <TrashIcon />
            </Button>
          </li>
        ))}
      </ul>
      {data && !data.hooks.length && (
        <Empty icon={<PaperPlaneTiltIcon />} title="No webhooks for this environment">
          <GuideLink to="webhooks">Payload and signature check</GuideLink>
        </Empty>
      )}
      {data && data.deliveries.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Delivery log</h3>
          <ul className="flex flex-col divide-y rounded-xl border text-sm" aria-label="Delivery log">
            {data.deliveries.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2">
                <span className={cn("w-20 shrink-0 font-medium", d.status === "delivered" ? "text-brand" : "text-destructive")}>{d.status}</span>
                <span className="text-muted-foreground">{when(d.at)}</span>
                <span className="text-muted-foreground">{d.event}{d.httpStatus ? ` · ${d.httpStatus}` : ""}{d.attempts > 1 ? ` · try ${d.attempts}` : ""}</span>
                <span className="min-w-0 flex-1 basis-40 truncate font-mono text-xs text-muted-foreground">{d.keys.join(", ")}</span>
                {d.message && <span className="basis-full text-xs text-destructive">{d.message}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {secret && (
        <Modal title="Copy the signing secret" description="Nimbus signs each delivery with HMAC-SHA256 in the X-Nimbus-Signature header (sha256=<hex> of the raw body). The secret is shown once." onClose={() => setSecret(null)}>
          <code className="block rounded-md border bg-muted px-3 py-2 font-mono text-sm break-all" data-testid="webhook-secret">{secret}</code>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => copySecret(secret)}>Copy</Button>
            <Button onClick={() => setSecret(null)}>Done</Button>
          </div>
        </Modal>
      )}
      {drop && (
        <Confirm
          title="Remove this webhook?"
          description="Nimbus stops sending to it and drops its delivery log."
          action="Remove"
          danger
          run={async () => {
            await api(`${base}/${drop}`, "DELETE")
            reload()
          }}
          onClose={() => setDrop(null)}
        />
      )}
    </div>
  )
}
