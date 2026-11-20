"use client"

import { Dialog } from "@base-ui/react/dialog"
import { ArrowRightIcon, CircleNotchIcon, CopySimpleIcon, PencilSimpleIcon, PlayIcon, PlusIcon, WarningCircleIcon } from "@phosphor-icons/react"
import { useId, useState, useTransition } from "react"

import { deleteMirror, runMirror, saveLoginToSecret, saveMirror, setMirrorEnabled } from "@/app/(app)/more/registry-tools/actions"
import { Empty } from "@/components/empty-state"
import { ago, every } from "@/components/gitbackup/format"
import { SecretsDialog } from "@/components/gitbackup/secrets-dialog"
import { DIALOG_BACKDROP, DIALOG_POPUP } from "@/components/overlay-styles"
import { Confirm, LIST, SELECT, Switch, TOUCH } from "@/components/registry-ui"
import { SubmitButton } from "@/components/submit-button"
import { useNotice } from "@/components/toaster"
import { FormError } from "@/components/two-factor"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { MirrorInput, MirrorView } from "@/lib/registry/tools"
import { cn } from "@/lib/utils"
import { INTERVALS } from "./format"

type Repo = { id: string; name: string }
type Form = { name: string; upstream: string; tags: string; cap: string; target: string; username: string; password: string; clearPassword: boolean; intervalMin: number }

const blank = (): Form => ({ name: "", upstream: "", tags: "latest", cap: "5", target: "", username: "", password: "", clearPassword: false, intervalMin: 1440 })
const fromMirror = (m: MirrorView): Form => ({ name: m.name, upstream: m.upstream, tags: m.tags, cap: String(m.cap), target: m.target, username: m.username ?? "", password: "", clearPassword: false, intervalMin: m.intervalMin })
const toInput = (f: Form): MirrorInput => ({ name: f.name, upstream: f.upstream, tags: f.tags, cap: f.cap.trim() ? Number(f.cap) : null, target: f.target, username: f.username, password: f.password, clearPassword: f.clearPassword, intervalMin: f.intervalMin })

function Editor({ mirror, repos, onClose, onSecret }: { mirror: MirrorView | null; repos: Repo[]; onClose: () => void; onSecret: (login: string) => void }) {
  const id = useId()
  const setNotice = useNotice()
  const [f, setF] = useState<Form>(() => (mirror ? fromMirror(mirror) : blank()))
  const [error, setError] = useState<string>()
  const [saving, save] = useTransition()
  const set = (p: Partial<Form>) => (setF({ ...f, ...p }), setError(undefined))
  return (
    <Dialog.Root open onOpenChange={(o) => !o && !saving && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={cn(DIALOG_POPUP, "max-h-[calc(100dvh-2rem)] max-w-xl overflow-y-auto")}>
          <div className="grid gap-1.5">
            <Dialog.Title className="text-base font-semibold">{mirror ? "Edit mirror" : "New mirror"}</Dialog.Title>
            <Dialog.Description className="text-sm text-pretty text-muted-foreground">Copies tags of an image from another registry into one of your repos, every platform included. A tag is copied again only when its digest changes.</Dialog.Description>
          </div>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              setError(undefined)
              save(async () => {
                const r = await saveMirror(mirror?.id ?? null, toInput(f))
                if (r.error) return setError(r.error)
                setNotice({ text: mirror ? "Mirror saved." : "Mirror added. The first copy starts within a minute." })
                if ("password" in r && r.password) onSecret(r.password)
                onClose()
              })
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-up`}>Image to mirror</Label>
              <Input id={`${id}-up`} value={f.upstream} onChange={(e) => set({ upstream: e.target.value })} placeholder="alpine, ghcr.io/org/app or quay.io/org/app" autoComplete="off" spellCheck={false} className="font-mono pointer-coarse:h-11" />
              <p className="text-sm text-muted-foreground">Without a registry address it&apos;s Docker Hub. Leave the tag out.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-tags`}>Tags</Label>
                <Input id={`${id}-tags`} value={f.tags} onChange={(e) => set({ tags: e.target.value })} placeholder="3.20, latest or 3.*" autoComplete="off" spellCheck={false} className="font-mono pointer-coarse:h-11" />
                <p className="text-sm text-muted-foreground">Names, or patterns with <span className="font-mono">*</span>, separated by commas.</p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-cap`}>At most</Label>
                <Input id={`${id}-cap`} type="number" inputMode="numeric" min={1} max={50} value={f.cap} onChange={(e) => set({ cap: e.target.value })} className="tabular-nums pointer-coarse:h-11" />
                <p className="text-sm text-muted-foreground">newest tags.</p>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-target`}>Copy into</Label>
              <Input id={`${id}-target`} list={`${id}-repos`} value={f.target} onChange={(e) => set({ target: e.target.value })} placeholder="yourname/alpine" autoComplete="off" spellCheck={false} className="font-mono pointer-coarse:h-11" />
              <datalist id={`${id}-repos`}>{repos.map((r) => <option key={r.id} value={r.name} />)}</datalist>
              <p className="text-sm text-muted-foreground">A repo you own or administer. A new name makes a new repo.</p>
            </div>
            <fieldset className="grid gap-3 rounded-lg border p-3">
              <legend className="px-1 text-sm font-medium">Upstream login (optional)</legend>
              <p className="text-sm text-pretty text-muted-foreground">For private images or to avoid Docker Hub&apos;s anonymous limits. Stored sealed; never shown again.</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor={`${id}-user`}>Username</Label>
                  <Input id={`${id}-user`} value={f.username} onChange={(e) => set({ username: e.target.value })} autoComplete="off" spellCheck={false} className="pointer-coarse:h-11" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`${id}-pw`}>Password or token</Label>
                  <Input id={`${id}-pw`} type="password" value={f.password} onChange={(e) => set({ password: e.target.value })} placeholder={mirror?.hasPassword && !f.clearPassword ? "••••••••••••" : ""} autoComplete="new-password" spellCheck={false} className="font-mono pointer-coarse:h-11" />
                </div>
              </div>
              {mirror?.hasPassword && (
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input type="checkbox" checked={f.clearPassword} onChange={(e) => set({ clearPassword: e.target.checked })} className="size-4 accent-primary" />
                  Remove the saved password
                </label>
              )}
            </fieldset>
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-name`}>Name (optional)</Label>
              <Input id={`${id}-name`} value={f.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} placeholder="Alpine" autoComplete="off" className="pointer-coarse:h-11" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-every`}>Check upstream</Label>
              <select id={`${id}-every`} value={f.intervalMin} onChange={(e) => set({ intervalMin: Number(e.target.value) })} className={cn(SELECT, "w-fit pointer-coarse:h-11")}>
                {INTERVALS.map(([m, l]) => <option key={m} value={m}>{l}</option>)}
                {!INTERVALS.some(([m]) => m === f.intervalMin) && <option value={f.intervalMin}>Every {every(f.intervalMin)}</option>}
              </select>
            </div>
            <FormError>{error}</FormError>
            <div className="flex justify-end gap-2">
              <Dialog.Close disabled={saving} render={<Button type="button" variant="outline" className={TOUCH} />}>Cancel</Dialog.Close>
              <SubmitButton pending={saving} disabled={!f.upstream.trim() || !f.target.trim()} className={TOUCH}>{mirror ? "Save" : "Add mirror"}</SubmitButton>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Row({ m, onEdit }: { m: MirrorView; onEdit: () => void }) {
  const setNotice = useNotice()
  const [pending, start] = useTransition()
  const act = (f: () => Promise<{ error?: string }>, ok: string) =>
    start(async () => {
      const res = await f()
      setNotice(res.error ? { text: res.error, error: true } : { text: ok })
    })
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-3 sm:px-4">
      <div className="grid min-w-0 flex-1 basis-60 gap-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 truncate text-sm font-medium" title={m.name}>{m.name}</span>
          {m.running && <Badge variant="outline"><CircleNotchIcon className="animate-spin motion-reduce:animate-none" />Copying</Badge>}
          {!m.running && m.lastStatus === "failed" && <Badge variant="outline" className="text-destructive"><WarningCircleIcon />Last run failed</Badge>}
          {!m.enabled && <Badge variant="secondary">Paused</Badge>}
        </div>
        <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 font-mono text-xs text-muted-foreground">
          <span className="truncate" title={m.upstream}>{m.upstream}</span>
          <ArrowRightIcon aria-label="copied into" className="size-3 shrink-0" />
          <span className="truncate" title={m.target}>{m.target}</span>
        </p>
        <p className="text-xs text-pretty text-muted-foreground" suppressHydrationWarning>
          Tags {m.tags}, newest {m.cap} · every {every(m.intervalMin)} · {m.lastRunAt ? `last ran ${ago(m.lastRunAt)}` : "not run yet"}{m.tracked > 0 && ` · ${m.tracked} tracked`}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Switch aria-label={`${m.name} is on`} checked={m.enabled} disabled={pending} onChange={(e) => { const on = e.target.checked; act(() => setMirrorEnabled(m.id, on), on ? "Mirror turned on." : "Mirror paused.") }} />
        <Button variant="outline" size="sm" className={TOUCH} disabled={pending || m.running} onClick={() => act(() => runMirror(m.id), "Copy started. See History for progress.")}>
          {pending ? <CircleNotchIcon className="animate-spin motion-reduce:animate-none" /> : <PlayIcon />}
          Run now
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label={`Edit ${m.name}`} className="pointer-coarse:size-11" onClick={onEdit}><PencilSimpleIcon /></Button>
        <Confirm label="Delete" question="Delete this mirror? Copied images stay." yes="Delete" pending={pending} onYes={() => act(() => deleteMirror(m.id), "Mirror deleted.")} />
      </div>
    </li>
  )
}

export function Mirrors({ mirrors, repos }: { mirrors: MirrorView[]; repos: Repo[] }) {
  const [editing, setEditing] = useState<MirrorView | "new" | null>(null)
  const [login, setLogin] = useState<string | null>(null)
  return (
    <section className="flex flex-col gap-4" aria-label="Mirrors">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">Keep copies of images from Docker Hub, GHCR, Quay or any registry in your own. You get a bell when a tag changes upstream.</p>
        <Button className={TOUCH} onClick={() => setEditing("new")}><PlusIcon />New mirror</Button>
      </div>
      {mirrors.length === 0 ? (
        <Empty icon={CopySimpleIcon} title="No mirrors yet">
          Mirror a base image like alpine so builds keep working when the upstream is down or rate limits you.
          <Button variant="outline" className={TOUCH} onClick={() => setEditing("new")}><PlusIcon />Add your first mirror</Button>
        </Empty>
      ) : (
        <ul className={LIST}>
          {mirrors.map((m) => <Row key={m.id} m={m} onEdit={() => setEditing(m)} />)}
        </ul>
      )}
      {editing && <Editor key={editing === "new" ? "new" : editing.id} mirror={editing === "new" ? null : editing} repos={repos} onClose={() => setEditing(null)} onSecret={setLogin} />}
      <SecretsDialog token={login} onClose={() => setLogin(null)} save={saveLoginToSecret} defaultName="REGISTRY_MIRROR_PASSWORD" />
    </section>
  )
}
