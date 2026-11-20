"use client"

import { CheckCircleIcon, HardDrivesIcon, KeyIcon, PlusIcon, WarningIcon } from "@phosphor-icons/react"
import { useId, useState, useTransition } from "react"

import { addHost, addSelf, deleteHost, dockerReady, newAgentToken, testHost } from "@/app/(app)/more/server-backup/actions"
import { CopyButton } from "@/components/copy-button"
import { Empty, Code, Confirm, LIST, RADIO, RADIO_INPUT, TOUCH } from "@/components/registry-ui"
import { SubmitButton } from "@/components/submit-button"
import { useNotice } from "@/components/toaster"
import { FormError } from "@/components/two-factor"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { HostView } from "@/lib/server-backup/hosts"
import type { TestResult } from "@/lib/server-backup/hosts"

const SOCKET = `# docker-compose.yml, on the app service (it runs the backups)
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock`

function PublicKey({ line }: { line: string }) {
  return (
    <div className="grid gap-2">
      <p className="text-sm text-pretty text-muted-foreground">
        Add this line to <code className="font-mono">~/.ssh/authorized_keys</code> of the user Nimbus logs in as, on the server:
      </p>
      <div className="relative">
        <Code copy wrap>{line}</Code>
        <CopyButton value={line} label="Copy the public key" className="absolute top-2 right-2" />
      </div>
    </div>
  )
}

function Token({ token }: { token: string }) {
  return (
    <div className="grid gap-2 rounded-lg border border-dashed p-3">
      <p className="text-sm font-medium">Agent token — shown once</p>
      <div className="relative">
        <Code copy wrap>{token}</Code>
        <CopyButton value={token} label="Copy the token" className="absolute top-2 right-2" />
      </div>
      <p className="text-sm text-pretty text-muted-foreground">
        Set it as <code className="font-mono">NIMBUS_AGENT_TOKEN</code> where the agent runs. Nimbus keeps only a hash, so a lost token means making a new one.
      </p>
    </div>
  )
}

function TestLine({ r }: { r: TestResult | { error: string } }) {
  if ("error" in r && r.error)
    return (
      <p role="alert" className="flex items-start gap-2 text-sm text-pretty text-destructive">
        <WarningIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>{r.error}{"changed" in r && r.changed ? ` New key: ${r.changed.fingerprint}.` : ""}</span>
      </p>
    )
  const t = r as TestResult
  return (
    <p role="status" className="flex items-start gap-2 text-sm text-pretty text-muted-foreground">
      <CheckCircleIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" />
      <span>
        Connected{t.recorded ? ". Host key recorded" : ""}
        {t.fingerprint ? <>: <span className="font-mono text-xs break-all">{t.fingerprint}</span></> : ""}.
        {t.docker === false ? " Docker wasn't found there, so volumes can't be listed." : ""}
      </span>
    </p>
  )
}

function HostRow({ host }: { host: HostView }) {
  const setNotice = useNotice()
  const [pending, start] = useTransition()
  const [result, setResult] = useState<TestResult | { error: string } | null>(null)
  const [token, setToken] = useState<string>()
  const [showKey, setShowKey] = useState(false)
  const [error, setError] = useState<string>()
  const test = (trust = false) =>
    start(async () => {
      setResult(null)
      const r = await testHost(host.id, trust)
      setResult(r)
    })
  const changed = result && "changed" in result ? result.changed : undefined
  return (
    <li className="flex flex-col gap-3 px-3 py-3 sm:px-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <HardDrivesIcon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
        <div className="grid min-w-0 flex-1 gap-0.5">
          <span className="truncate text-sm font-medium" title={host.label}>{host.label}</span>
          <span className="truncate font-mono text-xs text-muted-foreground" title={host.isSelf ? undefined : `${host.username}@${host.host}:${host.port}`}>
            {host.isSelf ? "Docker volumes on this Nimbus server" : host.mode === "agent" ? "Push agent" : `${host.username}@${host.host}:${host.port}`}
          </span>
        </div>
        {host.mode === "ssh" && !host.isSelf && (host.fingerprint ? <Badge variant="outline">Host key trusted</Badge> : <Badge variant="secondary">Not tested yet</Badge>)}
        <span className="text-xs text-muted-foreground tabular-nums">{host.jobs} {host.jobs === 1 ? "job" : "jobs"}</span>
      </div>
      {host.fingerprint && <p className="font-mono text-xs break-all text-muted-foreground">{host.fingerprint}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {host.mode === "ssh" && (
          <Button variant="outline" size="sm" className={TOUCH} disabled={pending} onClick={() => test()}>
            {pending ? "Testing…" : host.isSelf ? "Check Docker" : "Test connection"}
          </Button>
        )}
        {host.publicKey && (
          <Button variant="ghost" size="sm" className={TOUCH} aria-expanded={showKey} onClick={() => setShowKey(!showKey)}>
            <KeyIcon />
            {showKey ? "Hide public key" : "Public key"}
          </Button>
        )}
        {host.mode === "agent" && (
          <Button variant="outline" size="sm" className={TOUCH} disabled={pending} onClick={() => start(async () => { const r = await newAgentToken(host.id); if ("token" in r && r.token) setToken(r.token); else setError("error" in r && r.error ? r.error : "Couldn't make a token.") })}>
            New token
          </Button>
        )}
        <span className="ml-auto">
          <Confirm label="Delete" question={host.jobs ? "Has jobs. Delete them first." : "Delete this server?"} yes="Delete" pending={pending} disabled={host.jobs > 0} onYes={() => start(async () => { const r = await deleteHost(host.id); if (r.error) setError(r.error); else setNotice({ text: "Server deleted." }) })} />
        </span>
      </div>
      {showKey && host.publicKey && <PublicKey line={host.publicKey} />}
      {token && <Token token={token} />}
      {result && host.isSelf && "ok" in result && (
        <div role="status" className="grid gap-2 text-sm text-pretty text-muted-foreground">
          {result.docker ? (
            <p className="flex items-start gap-2"><CheckCircleIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" />The Docker socket is mounted. Nimbus can read this server&apos;s volumes.</p>
          ) : (
            <>
              <p className="flex items-start gap-2"><WarningIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />The Docker socket isn&apos;t mounted in this container, so volumes can&apos;t be read. Mount it, then run <code className="font-mono">docker compose up -d</code>:</p>
              <Code>{SOCKET}</Code>
            </>
          )}
        </div>
      )}
      {result && !host.isSelf && <TestLine r={result} />}
      {changed && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm">
          <span className="min-w-0 flex-1 text-pretty">Only trust a new host key if you reinstalled or re-keyed the server yourself. Backups stay blocked until you do.</span>
          <Button variant="outline" size="sm" className={TOUCH} disabled={pending} onClick={() => test(true)}>Trust the new key</Button>
        </div>
      )}
      <FormError>{error}</FormError>
    </li>
  )
}

type Created = { id: string; token?: string; publicKey?: string }

function AddForm({ onClose, firstHost }: { onClose: () => void; firstHost: boolean }) {
  const id = useId()
  const [mode, setMode] = useState<"ssh" | "agent">("ssh")
  const [v, setV] = useState({ label: "", host: "", port: "22", username: "root" })
  const [error, setError] = useState<string>()
  const [created, setCreated] = useState<Created | null>(null)
  const [pending, start] = useTransition()
  const set = (p: Partial<typeof v>) => setV((x) => ({ ...x, ...p }))
  const field = (k: keyof typeof v, label: string, ph: string, extra?: React.ComponentProps<typeof Input>) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`${id}-${k}`}>{label}</Label>
      <Input id={`${id}-${k}`} value={v[k]} onChange={(e) => set({ [k]: e.target.value })} placeholder={ph} autoComplete="off" spellCheck={false} className="pointer-coarse:h-11" {...extra} />
    </div>
  )
  if (created)
    return (
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-4 sm:p-5">
        <h3 className="text-base font-semibold">{created.token ? "Agent created" : "Now let this server trust Nimbus"}</h3>
        {created.token ? <Token token={created.token} /> : created.publicKey ? <PublicKey line={created.publicKey} /> : null}
        <p className="text-sm text-pretty text-muted-foreground">
          {created.token ? "Next, make a backup job for this server. Its Overview has the script to download and the cron line to run." : "Then press Test connection in the list below. Nimbus records the server's host key then, and you can check its fingerprint."}
        </p>
        <div><Button className={TOUCH} onClick={onClose}>Done</Button></div>
      </div>
    )
  return (
    <form
      className="flex flex-col gap-4 rounded-xl border bg-card p-4 sm:p-5"
      onSubmit={(e) => {
        e.preventDefault()
        setError(undefined)
        start(async () => {
          const r = await addHost({ label: v.label, host: v.host, port: Number(v.port), username: v.username, mode })
          if ("error" in r && r.error) return setError(r.error)
          setCreated(r as Created)
        })
      }}
    >
      <h3 className="text-base font-semibold">{firstHost ? "Add your first server" : "Add a server"}</h3>
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="sr-only">How Nimbus reaches it</legend>
        <label className={RADIO + " items-start"}>
          <input type="radio" name={`${id}-mode`} className={RADIO_INPUT + " mt-0.5"} checked={mode === "ssh"} onChange={() => setMode("ssh")} />
          <span className="grid gap-0.5"><span className="font-medium">Nimbus connects over SSH</span><span className="text-muted-foreground">Nimbus makes a key for you to add to the server.</span></span>
        </label>
        <label className={RADIO + " items-start"}>
          <input type="radio" name={`${id}-mode`} className={RADIO_INPUT + " mt-0.5"} checked={mode === "agent"} onChange={() => setMode("agent")} />
          <span className="grid gap-0.5"><span className="font-medium">The server pushes</span><span className="text-muted-foreground">A script on the server runs restic. For servers Nimbus can&apos;t reach.</span></span>
        </label>
      </fieldset>
      {field("label", "Name", "Web server", { maxLength: 60 })}
      {mode === "ssh" && (
        <div className="grid gap-4 sm:grid-cols-[1fr_6rem_10rem]">
          {field("host", "Host or IP address", "203.0.113.7")}
          {field("port", "Port", "22", { type: "number", inputMode: "numeric", min: 1, max: 65535 })}
          {field("username", "User", "root")}
        </div>
      )}
      <FormError>{error}</FormError>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" className={TOUCH} disabled={pending} onClick={onClose}>Cancel</Button>
        <SubmitButton pending={pending} disabled={!v.label.trim() || (mode === "ssh" && !v.host.trim())} className={TOUCH}>Add server</SubmitButton>
      </div>
    </form>
  )
}

export function HostsManager({ hosts, admin, intro, onDone }: { hosts: HostView[]; admin: boolean; intro?: boolean; onDone?: () => void }) {
  const [adding, setAdding] = useState(intro && hosts.length === 0)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string>()
  const hasSelf = hosts.some((h) => h.isSelf)
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto grid gap-1">
          <h2 className="text-base font-semibold">Servers</h2>
          <p className="max-w-prose text-sm text-pretty text-muted-foreground">Nimbus logs in with its own key, never your password, and refuses a server whose host key changes.</p>
        </div>
        {!adding && (
          <div className="flex flex-wrap gap-2">
            {admin && !hasSelf && (
              <Button variant="outline" className={TOUCH} disabled={pending} onClick={() => start(async () => { const r = await addSelf(); if ("error" in r && r.error) setError(r.error); else void dockerReady() })}>
                This Nimbus server
              </Button>
            )}
            <Button className={TOUCH} onClick={() => setAdding(true)}>
              <PlusIcon />
              Add a server
            </Button>
          </div>
        )}
      </div>
      <FormError>{error}</FormError>
      {adding && <AddForm firstHost={hosts.length === 0} onClose={() => (setAdding(false), onDone?.())} />}
      {hosts.length === 0 && !adding ? (
        <Empty icon={HardDrivesIcon} title="No servers yet">Add a server Nimbus can reach over SSH, or one that pushes its own backups.</Empty>
      ) : (
        hosts.length > 0 && <ul className={LIST}>{hosts.map((h) => <HostRow key={h.id} host={h} />)}</ul>
      )}
    </div>
  )
}
