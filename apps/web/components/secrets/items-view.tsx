"use client"

import { CopyIcon, DatabaseIcon, DownloadSimpleIcon, EyeIcon, EyeSlashIcon, FileIcon, KeyIcon, NoteIcon, PencilSimpleIcon, PlusIcon, TrashIcon, UserCircleIcon } from "@phosphor-icons/react"
import { useEffect, useRef, useState } from "react"

import { useLoad } from "@/components/secrets/access-view"
import { api, copySecret, errorText } from "@/components/secrets/client"
import { PwnedHint } from "@/components/secrets/pwned-hint"
import { Empty, Expiry, TEXTAREA, readB64, useBusy } from "@/components/secrets/pki-ui"
import { Confirm, Loading, Modal, SELECT } from "@/components/secrets/ui"
import { SubmitButton } from "@/components/submit-button"
import { useNotice } from "@/components/toaster"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

type Kind = "login" | "api_key" | "db" | "note" | "file"
type Item = { id: string; kind: Kind; name: string; expiresAt: string | null; updatedAt: string }
type Opened = Item & { data: Record<string, string> }
type Field = { key: string; label: string; secret?: boolean; area?: boolean; hint?: string }

const KINDS: Record<Kind, { label: string; icon: typeof KeyIcon; fields: Field[] }> = {
  login: { label: "Login", icon: UserCircleIcon, fields: [{ key: "username", label: "Username" }, { key: "password", label: "Password", secret: true }, { key: "url", label: "URL" }, { key: "totp", label: "TOTP secret", secret: true, hint: "A base32 secret or a whole otpauth:// link." }, { key: "notes", label: "Notes", area: true }] },
  api_key: { label: "API key", icon: KeyIcon, fields: [{ key: "provider", label: "Provider" }, { key: "token", label: "Key or token", secret: true }, { key: "scopes", label: "Scopes" }, { key: "notes", label: "Notes", area: true }] },
  db: { label: "Database", icon: DatabaseIcon, fields: [{ key: "engine", label: "Engine" }, { key: "host", label: "Host" }, { key: "port", label: "Port" }, { key: "database", label: "Database" }, { key: "username", label: "Username" }, { key: "password", label: "Password", secret: true }, { key: "notes", label: "Notes", area: true }] },
  note: { label: "Secure note", icon: NoteIcon, fields: [{ key: "body", label: "Note", area: true, secret: true }] },
  file: { label: "File", icon: FileIcon, fields: [{ key: "notes", label: "Notes", area: true }] },
}
const ENGINES = ["postgres", "mysql", "mariadb", "mongodb", "redis"]
const SCHEME: Record<string, string> = { postgres: "postgres", mysql: "mysql", mariadb: "mysql", mongodb: "mongodb", redis: "redis" }

export function dbUrl(d: Record<string, string>) {
  const auth = d.username ? `${encodeURIComponent(d.username)}${d.password ? `:${encodeURIComponent(d.password)}` : ""}@` : ""
  return `${SCHEME[d.engine] ?? d.engine ?? "postgres"}://${auth}${d.host ?? ""}${d.port ? `:${d.port}` : ""}${d.database ? `/${encodeURIComponent(d.database)}` : ""}`
}

export function ItemsView({ projectId, role }: { projectId: string; role: string }) {
  const base = `/projects/${projectId}/items`
  const { data, error, reload } = useLoad<{ items: Item[] }>(base)
  const [kind, setKind] = useState<Kind | "all">("all")
  const [q, setQ] = useState("")
  const [form, setForm] = useState<{ item?: Opened; kind: Kind } | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const canWrite = role !== "viewer"
  const shown = (data?.items ?? []).filter((i) => (kind === "all" || i.kind === kind) && i.name.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Items</h2>
        {canWrite && (
          <Button className="ml-auto" onClick={() => setPicking(true)}>
            <PlusIcon />
            New item
          </Button>
        )}
      </div>
      <p className="max-w-prose text-sm text-pretty text-muted-foreground">
        Logins, API keys, database connections, notes and small files. Everything inside is sealed with the project key; opening an item is logged. Only the name is searchable.
      </p>
      <div className="flex flex-wrap gap-2">
        <Input aria-label="Filter items by name" placeholder="Filter by name" value={q} onChange={(e) => setQ(e.target.value)} className="w-full sm:w-56" />
        <select aria-label="Type" className={cn(SELECT, "w-auto min-w-36")} value={kind} onChange={(e) => setKind(e.target.value as Kind | "all")}>
          <option value="all">All types</option>
          {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>
      <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
      {!data ? (
        <Loading />
      ) : shown.length === 0 ? (
        <Empty icon={<KeyIcon />} title={data.items.length ? "Nothing matches" : "No items yet"}>
          {data.items.length ? undefined : "Keep the logins, keys and notes your team needs next to its secrets."}
        </Empty>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border">
          {shown.map((i) => {
            const K = KINDS[i.kind]
            return (
              <li key={i.id}>
                <button onClick={() => setOpen(i.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none hover:bg-muted/40 focus-visible:bg-muted/40">
                  <K.icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate font-medium">{i.name}</span>
                  <span className="text-xs text-muted-foreground">{K.label}</span>
                  {i.expiresAt && <span className="ml-auto"><Expiry at={i.expiresAt} /></span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {picking && (
        <Modal title="New item" description="What do you want to keep?" onClose={() => setPicking(false)}>
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.entries(KINDS).map(([k, v]) => (
              <Button key={k} variant="outline" className="justify-start" onClick={() => { setPicking(false); setForm({ kind: k as Kind }) }}>
                <v.icon />
                {v.label}
              </Button>
            ))}
          </div>
        </Modal>
      )}
      {open && <ItemDialog base={base} id={open} canWrite={canWrite} onClose={() => setOpen(null)} onEdit={(item) => { setOpen(null); setForm({ item, kind: item.kind }) }} onChanged={reload} />}
      {form && <ItemForm base={base} kind={form.kind} item={form.item} onClose={() => setForm(null)} onDone={reload} />}
    </div>
  )
}

function ItemForm({ base, kind, item, onClose, onDone }: { base: string; kind: Kind; item?: Opened; onClose: () => void; onDone: () => void }) {
  const K = KINDS[kind]
  const { busy, error, setError, setBusy } = useBusy()
  const [file, setFile] = useState<{ name: string; mime: string; b64: string } | null>(null)
  const pick = useRef<HTMLInputElement>(null)
  const [pw, setPw] = useState("")
  return (
    <Modal title={item ? `Edit ${item.name}` : `New ${K.label.toLowerCase()}`} onClose={onClose}>
      <form
        className="grid gap-4"
        autoComplete="off"
        onSubmit={async (e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          const data: Record<string, string> = {}
          for (const { key } of K.fields) data[key] = String(f.get(key) ?? "")
          if (kind === "db") data.engine = String(f.get("engine"))
          if (kind === "file" && file) Object.assign(data, { filename: file.name, mime: file.mime, content: file.b64 })
          const exp = String(f.get("expiresAt") ?? "")
          setBusy(true)
          try {
            if (item) await api(`${base}/${item.id}`, "PATCH", { name: f.get("name"), data, ...(kind === "api_key" ? { expiresAt: exp || null } : {}) })
            else await api(base, "POST", { kind, name: f.get("name"), data, ...(kind === "api_key" ? { expiresAt: exp || null } : {}) })
            onDone()
            onClose()
          } catch (er) {
            setError(errorText(er))
            setBusy(false)
          }
        }}
      >
        <div className="grid gap-2"><Label htmlFor="it-name">Name</Label><Input id="it-name" name="name" maxLength={80} required autoFocus defaultValue={item?.name} /></div>
        {kind === "db" && (
          <div className="grid gap-2">
            <Label htmlFor="it-engine">Engine</Label>
            <select id="it-engine" name="engine" className={SELECT} defaultValue={item?.data.engine || "postgres"}>{ENGINES.map((e) => <option key={e}>{e}</option>)}</select>
          </div>
        )}
        {kind === "file" && (
          <div className="grid gap-2">
            <input ref={pick} type="file" hidden aria-label="File" onChange={async (e) => {
              const f = e.target.files?.[0]
              if (!f) return
              if (f.size > 1024 * 1024) return setError("Files up to 1 MB. Put bigger ones in Files.")
              setError(null)
              setFile({ name: f.name, mime: f.type, b64: (await readB64([f]))[0] })
            }} />
            <Label>File</Label>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={() => pick.current?.click()}>Choose file</Button>
              <span className="min-w-0 truncate text-sm text-muted-foreground">{file?.name ?? item?.data.filename ?? "Up to 1 MB"}</span>
            </div>
          </div>
        )}
        {K.fields.filter((f) => !(kind === "db" && f.key === "engine")).map((f) => (
          <div className="grid gap-2" key={f.key}>
            <Label htmlFor={`it-${f.key}`}>{f.label}</Label>
            {f.area ? (
              <textarea id={`it-${f.key}`} name={f.key} rows={f.key === "body" ? 8 : 3} className={TEXTAREA} spellCheck={false} defaultValue={item?.data[f.key]} />
            ) : (
              <Input id={`it-${f.key}`} name={f.key} type={f.secret ? "password" : "text"} autoComplete="off" spellCheck={false} defaultValue={item?.data[f.key]} onChange={kind === "login" && f.key === "password" ? (e) => setPw(e.target.value) : undefined} />
            )}
            {kind === "login" && f.key === "password" && <PwnedHint value={pw} />}
            {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
          </div>
        ))}
        {kind === "api_key" && (
          <div className="grid gap-2">
            <Label htmlFor="it-exp">Expires</Label>
            <Input id="it-exp" name="expiresAt" type="date" defaultValue={item?.expiresAt?.slice(0, 10)} />
            <p className="text-xs text-muted-foreground">Project admins are told 30, 7 and 1 day before.</p>
          </div>
        )}
        <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><SubmitButton pending={busy}>{item ? "Save" : "Add"}</SubmitButton></div>
      </form>
    </Modal>
  )
}

function ItemDialog({ base, id, canWrite, onClose, onEdit, onChanged }: { base: string; id: string; canWrite: boolean; onClose: () => void; onEdit: (i: Opened) => void; onChanged: () => void }) {
  const notify = useNotice()
  const [item, setItem] = useState<Opened | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [shown, setShown] = useState<Set<string>>(new Set())
  const [del, setDel] = useState(false)
  useEffect(() => {
    api<Opened>(`${base}/${id}`).then(setItem).catch((e) => setError(errorText(e)))
  }, [base, id])
  const copy = async (text: string) => {
    try {
      await api(`${base}/${id}?copy=1`) // the log line for the copy
      await copySecret(text)
      notify({ text: "Copied. The clipboard clears in 30 seconds." })
    } catch (e) {
      setError(errorText(e))
    }
  }
  const K = item ? KINDS[item.kind] : null
  return (
    <Modal title={item?.name ?? "Item"} description={K?.label} onClose={onClose} wide>
      <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
      {item && K && (
        <>
          <dl className="grid gap-3">
            {item.kind === "db" && item.data.engine && <Line k="Engine" v={item.data.engine} />}
            {K.fields.filter((f) => item.data[f.key]).map((f) => (
              <div key={f.key} className="grid gap-0.5 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-3">
                <dt className="text-xs text-muted-foreground sm:pt-1.5">{f.label}</dt>
                <dd className="flex min-w-0 items-start gap-1">
                  <span className={cn("min-w-0 flex-1 py-1 text-sm break-words whitespace-pre-wrap", f.secret && "font-mono")}>
                    {f.secret && !shown.has(f.key) ? "••••••••••" : item.data[f.key]}
                  </span>
                  {f.secret && (
                    <Button variant="ghost" size="icon-sm" aria-label={`${shown.has(f.key) ? "Hide" : "Show"} ${f.label}`} onClick={() => setShown((s) => { const n = new Set(s); if (!n.delete(f.key)) n.add(f.key); return n })}>
                      {shown.has(f.key) ? <EyeSlashIcon /> : <EyeIcon />}
                    </Button>
                  )}
                  <Button variant="ghost" size="icon-sm" aria-label={`Copy ${f.label}`} onClick={() => copy(item.data[f.key])}><CopyIcon /></Button>
                </dd>
              </div>
            ))}
            {item.kind === "file" && <Line k="File" v={item.data.filename || item.name} />}
            {item.expiresAt && <Line k="Expires" v={<Expiry at={item.expiresAt} />} />}
          </dl>
          {item.kind === "login" && item.data.totp && <TotpCode base={base} id={id} />}
          <div className="flex flex-wrap justify-end gap-2">
            {item.kind === "db" && <Button variant="outline" onClick={() => copy(dbUrl(item.data))}><CopyIcon />Copy as URL</Button>}
            {item.kind === "file" && <Button variant="outline" render={<a href={`/api/v1/secrets${base}/${id}/file`} download />}><DownloadSimpleIcon />Download</Button>}
            {canWrite && <Button variant="outline" onClick={() => onEdit(item)}><PencilSimpleIcon />Edit</Button>}
            {canWrite && <Button variant="outline" className="text-destructive" onClick={() => setDel(true)}><TrashIcon />Delete</Button>}
          </div>
        </>
      )}
      {del && <Confirm title="Delete this item?" description="It's deleted for good." action="Delete" danger run={async () => { await api(`${base}/${id}`, "DELETE"); onChanged(); onClose() }} onClose={() => setDel(false)} />}
    </Modal>
  )
}

const Line = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="grid gap-0.5 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-3"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="text-sm">{v}</dd></div>
)

// The live code: the server computes it (the secret isn't shown), and we count down to the next one.
function TotpCode({ base, id }: { base: string; id: string }) {
  const notify = useNotice()
  const [on, setOn] = useState(false)
  const [c, setC] = useState<{ code: string; remaining: number; period: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [left, setLeft] = useState(0)
  const fetched = useRef(false)
  useEffect(() => {
    if (!on) return
    let live = true
    const get = () =>
      api<{ code: string; remaining: number; period: number }>(`${base}/${id}/totp${fetched.current ? "" : "?first=1"}`)
        .then((r) => { fetched.current = true; if (live) { setC(r); setLeft(r.remaining) } })
        .catch((e) => live && setError(errorText(e)))
    get()
    const t = setInterval(() => setLeft((l) => { if (l <= 1) { get(); return l } return l - 1 }), 1000)
    return () => { live = false; clearInterval(t) }
  }, [on, base, id])
  return (
    <div className="flex items-center gap-3 rounded-lg border px-3 py-2">
      <span className="text-xs text-muted-foreground">One-time code</span>
      {!on ? (
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => setOn(true)}>Show code</Button>
      ) : (
        <>
          <span className="font-mono text-xl tracking-widest tabular-nums" aria-live="off">{c ? `${c.code.slice(0, Math.ceil(c.code.length / 2))} ${c.code.slice(Math.ceil(c.code.length / 2))}` : "······"}</span>
          {c && <span className="text-sm text-muted-foreground tabular-nums" aria-label={`${left} seconds left`}>{left}s</span>}
          {c && <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label="Copy code" onClick={() => copySecret(c.code).then(() => notify({ text: "Copied." }))}><CopyIcon /></Button>}
        </>
      )}
      <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
    </div>
  )
}
