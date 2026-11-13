"use client"

import { ArrowLeftIcon, FileTextIcon, MagnifyingGlassIcon, ShieldCheckIcon } from "@phosphor-icons/react"
import Link from "next/link"
import { useEffect, useState } from "react"

import { useLoad } from "@/components/secrets/access-view"
import { api, errorText } from "@/components/secrets/client"
import { CHECKBOX, Modal, SELECT } from "@/components/secrets/ui"
import { Empty, Tabs, useBusy } from "@/components/secrets/pki-ui"
import { SubmitButton } from "@/components/submit-button"
import { useNotice } from "@/components/toaster"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Leak = { id: string; file: string; href: string; rule: string; label: string; line: number; masked: string; status: string; suggestedKey: string }
type Project = { id: string; name: string }

const STATUS: Record<string, string> = { dismissed: "Dismissed", false_positive: "False positive", moved: "Moved to Secrets" }

// Possible secrets Nimbus found in your own files. Only a masked preview is kept; the
// full text is read from the file again when you move it.
export function LeaksView({ projects }: { projects: Project[] }) {
  const notify = useNotice()
  const [tab, setTab] = useState<"open" | "closed">("open")
  const { data, error, reload } = useLoad<{ enabled: boolean; leaks: Leak[] }>(`/leaks?status=${tab}`)
  const [moving, setMoving] = useState<Leak | null>(null)
  const [scanning, setScanning] = useState(false)
  const act = (l: Leak, action: "dismiss" | "false_positive" | "reopen", done: string) =>
    api(`/leaks/${l.id}`, "POST", { action })
      .then(() => (notify({ text: done }), reload()))
      .catch((e) => notify({ text: errorText(e) }))
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" render={<Link href="/secrets" />}>
          <ArrowLeftIcon />
          Projects
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">Leaks</h1>
        {data?.enabled !== false && (
          <Button
            variant="outline"
            className="ml-auto"
            disabled={scanning}
            onClick={async () => {
              setScanning(true)
              try {
                await api("/leaks/scan", "POST")
                notify({ text: "Scanning your files. You'll get a notice when it's done." })
              } catch (e) {
                notify({ text: errorText(e) })
              } finally {
                setScanning(false)
              }
            }}
          >
            <MagnifyingGlassIcon />
            Scan my files
          </Button>
        )}
      </div>
      <p className="max-w-prose text-sm text-pretty text-muted-foreground">
        Nimbus checks text and code files you upload for keys, tokens and passwords that shouldn&apos;t be there. Vault files are never read. Only a masked preview and a fingerprint are kept.
      </p>
      {data?.enabled === false && <p className="rounded-xl border px-4 py-3 text-sm">An admin turned file scanning off. Earlier findings stay here.</p>}
      <Tabs label="Findings" tabs={[["open", "Open"], ["closed", "Closed"]] as const} value={tab} onChange={setTab} />
      <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
      {!data ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : data.leaks.length === 0 ? (
        <Empty icon={<ShieldCheckIcon />} title={tab === "open" ? "Nothing found" : "Nothing closed yet"}>
          {tab === "open" ? "No possible secrets in your files. New uploads are checked as they arrive." : undefined}
        </Empty>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border">
          {data.leaks.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1 basis-64">
                <p className="truncate text-sm font-medium">
                  <Link href={l.href} className="underline-offset-2 hover:underline">{l.file}</Link>
                  <span className="font-normal text-muted-foreground"> · line {l.line}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {l.label} <code className="ml-1 rounded bg-muted px-1.5 py-0.5 font-mono">{l.masked}</code>
                  {tab === "closed" && ` · ${STATUS[l.status] ?? l.status}`}
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                {tab === "open" ? (
                  <>
                    {projects.length > 0 && <Button size="sm" onClick={() => setMoving(l)}>Move to Secrets</Button>}
                    <Button size="sm" variant="outline" onClick={() => act(l, "dismiss", "Dismissed.")}>Dismiss</Button>
                    <Button size="sm" variant="outline" onClick={() => act(l, "false_positive", "Marked as a false positive. It won't be reported again.")}>False positive</Button>
                  </>
                ) : (
                  l.status !== "moved" && <Button size="sm" variant="outline" onClick={() => act(l, "reopen", "Reopened.")}>Reopen</Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {moving && <MoveDialog leak={moving} projects={projects} onClose={() => setMoving(null)} onDone={reload} />}
    </div>
  )
}

function MoveDialog({ leak, projects, onClose, onDone }: { leak: Leak; projects: Project[]; onClose: () => void; onDone: () => void }) {
  const notify = useNotice()
  const { busy, error, setError, setBusy } = useBusy()
  const [project, setProject] = useState(projects[0].id)
  const [envs, setEnvs] = useState<{ id: string; name: string }[]>([])
  const [env, setEnv] = useState("")
  const [key, setKey] = useState(leak.suggestedKey)
  const [redact, setRedact] = useState(true)
  useEffect(() => {
    api<{ envs: { id: string; name: string }[] }>(`/projects/${project}/envs`)
      .then((r) => (setEnvs(r.envs), setEnv(r.envs[0]?.id ?? "")))
      .catch((e) => setError(errorText(e)))
  }, [project, setError])
  return (
    <Modal title="Move to Secrets" description={`Saves the text from ${leak.file}, line ${leak.line}, as a secret. It's sealed with the project key.`} onClose={onClose}>
      <form
        className="grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError(null)
          try {
            const r = await api<{ request: unknown; redacted: boolean }>(`/leaks/${leak.id}`, "POST", { action: "move", projectId: project, envId: env, key: key.trim(), redact })
            notify({ text: r.request ? "Sent for review in that project." : r.redacted ? "Moved, and the file now has REDACTED in its place." : "Moved to Secrets." })
            onDone()
            onClose()
          } catch (er) {
            setError(errorText(er))
            setBusy(false)
          }
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="mv-project">Project</Label>
            <select id="mv-project" className={SELECT} value={project} onChange={(e) => setProject(e.target.value)}>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="mv-env">Environment</Label>
            <select id="mv-env" className={SELECT} value={env} onChange={(e) => setEnv(e.target.value)}>
              {envs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="mv-key">Key name</Label>
          <Input id="mv-key" value={key} onChange={(e) => setKey(e.target.value)} className="font-mono" maxLength={200} required />
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className={`${CHECKBOX} mt-0.5`} checked={redact} onChange={(e) => setRedact(e.target.checked)} />
          <span className="text-pretty">
            Replace it in the file with REDACTED. This saves a new version of the file; the old one stays in its history, so delete that version too if the secret must go.
          </span>
        </label>
        <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <SubmitButton pending={busy} disabled={!env || !key.trim()}>Move</SubmitButton>
        </div>
      </form>
    </Modal>
  )
}
