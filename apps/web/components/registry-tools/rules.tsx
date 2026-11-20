"use client"

import { Dialog } from "@base-ui/react/dialog"
import { BroomIcon, CircleNotchIcon, PencilSimpleIcon, PlayIcon, PlusIcon, WarningCircleIcon } from "@phosphor-icons/react"
import { useId, useState, useTransition } from "react"

import { deleteRule, dryRun, runRule, saveRule, setRuleEnabled } from "@/app/(app)/more/registry-tools/actions"
import { ago, every } from "@/components/gitbackup/format"
import { Empty } from "@/components/empty-state"
import { DIALOG_BACKDROP, DIALOG_POPUP } from "@/components/overlay-styles"
import { Confirm, LIST, RADIO, RADIO_INPUT, SELECT, Switch, TOUCH } from "@/components/registry-ui"
import { SubmitButton } from "@/components/submit-button"
import { useNotice } from "@/components/toaster"
import { FormError } from "@/components/two-factor"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatBytes } from "@/lib/file-rules"
import type { Preview, RuleInput, RuleView } from "@/lib/registry/tools"
import { cn } from "@/lib/utils"
import { INTERVALS, short } from "./format"

type Repo = { id: string; name: string }
type Form = { name: string; mode: "repo" | "pattern"; repoId: string; pattern: string; keepLast: string; olderThanDays: string; keepRegex: string; deleteUntagged: boolean; intervalMin: number }

const blank = (repos: Repo[]): Form => ({ name: "", mode: "repo", repoId: repos[0]?.id ?? "", pattern: "", keepLast: "10", olderThanDays: "", keepRegex: "", deleteUntagged: true, intervalMin: 1440 })
const fromRule = (r: RuleView): Form => ({
  name: r.name, mode: r.repoId ? "repo" : "pattern", repoId: r.repoId ?? "", pattern: r.pattern ?? "",
  keepLast: r.keepLast ? String(r.keepLast) : "", olderThanDays: r.olderThanDays ? String(r.olderThanDays) : "", keepRegex: r.keepRegex ?? "",
  deleteUntagged: r.deleteUntagged, intervalMin: r.intervalMin,
})
const num = (s: string) => (s.trim() ? Number(s) : null)
const toInput = (f: Form): RuleInput => ({
  name: f.name, repoId: f.mode === "repo" ? f.repoId : null, pattern: f.mode === "pattern" ? f.pattern : null,
  keepLast: num(f.keepLast), olderThanDays: num(f.olderThanDays), keepRegex: f.keepRegex, deleteUntagged: f.deleteUntagged, intervalMin: f.intervalMin,
})

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`

function what(r: RuleView) {
  return [
    r.keepLast && `Keep the newest ${r.keepLast}`,
    r.olderThanDays && `delete older than ${plural(r.olderThanDays, "day")}`,
    r.keepRegex && `always keep /${r.keepRegex}/`,
    r.deleteUntagged && "delete untagged",
  ].filter(Boolean).join(" · ")
}

function PreviewPanel({ p }: { p: Preview }) {
  if (!p.repos.length)
    return <p role="status" className="rounded-lg border bg-input/10 px-3 py-2.5 text-sm text-pretty text-muted-foreground">Nothing matches right now. Checked {plural(p.scanned, "repo")}; this rule would remove nothing.</p>
  return (
    <div role="status" className="grid gap-2 rounded-lg border bg-input/10 p-3">
      <p className="text-sm font-medium text-pretty">
        Would remove {plural(p.tags, "tag")} and {plural(p.manifests, "untagged image")} from {plural(p.repos.length, "repo")}
        {p.bytes > 0 && <> and free about <span className="tabular-nums">{formatBytes(p.bytes)}</span></>}.
      </p>
      <p className="text-xs text-pretty text-muted-foreground">Nothing was deleted. A real run moves these to Trash for 7 days; space comes back when garbage collection runs after that.</p>
      <ul className="grid max-h-56 gap-1 overflow-y-auto">
        {p.repos.map((r) => (
          <li key={r.repo}>
            <details className="rounded-md border bg-background/40 px-3 py-2 text-sm">
              <summary className="flex cursor-pointer flex-wrap items-center gap-x-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                <span className="min-w-0 truncate font-mono text-xs">{r.repo}</span>
                <span className="text-xs text-muted-foreground">{plural(r.tags.length, "tag")}, {plural(r.manifests.length, "image")}{r.bytes > 0 && `, ${formatBytes(r.bytes)}`}</span>
              </summary>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {r.tags.map((t) => <Badge key={t} variant="outline" className="font-mono">{t}</Badge>)}
                {r.manifests.map((d) => <Badge key={d} variant="secondary" className="font-mono" title={d}>{short(d)}</Badge>)}
              </div>
            </details>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Editor({ rule, repos, open, onClose }: { rule: RuleView | null; repos: Repo[]; open: boolean; onClose: () => void }) {
  const id = useId()
  const setNotice = useNotice()
  const [f, setF] = useState<Form>(() => (rule ? fromRule(rule) : blank(repos)))
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState<string>()
  const [checking, check] = useTransition()
  const [saving, save] = useTransition()
  const set = (p: Partial<Form>) => (setF({ ...f, ...p }), setPreview(null), setError(undefined))
  const scoped = f.mode === "repo" ? Boolean(f.repoId) : Boolean(f.pattern.trim())
  const ready = scoped && Boolean(f.keepLast.trim() || f.olderThanDays.trim() || f.deleteUntagged)
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && !saving && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={cn(DIALOG_POPUP, "max-h-[calc(100dvh-2rem)] max-w-xl overflow-y-auto")}>
          <div className="grid gap-1.5">
            <Dialog.Title className="text-base font-semibold">{rule ? "Edit rule" : "New cleanup rule"}</Dialog.Title>
            <Dialog.Description className="text-sm text-pretty text-muted-foreground">Removes tags and untagged images from repos you own or administer. Immutable tags are never touched.</Dialog.Description>
          </div>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              setError(undefined)
              save(async () => {
                const r = await saveRule(rule?.id ?? null, toInput(f))
                if (r.error) return setError(r.error)
                setNotice({ text: rule ? "Rule saved." : "Rule added. It runs within a minute." })
                onClose()
              })
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-name`}>Name (optional)</Label>
              <Input id={`${id}-name`} value={f.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} placeholder="Keep ten builds" autoComplete="off" className="pointer-coarse:h-11" />
            </div>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Applies to</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className={RADIO}>
                  <input type="radio" name={`${id}-mode`} className={RADIO_INPUT} checked={f.mode === "repo"} onChange={() => set({ mode: "repo" })} />
                  One repo
                </label>
                <label className={RADIO}>
                  <input type="radio" name={`${id}-mode`} className={RADIO_INPUT} checked={f.mode === "pattern"} onChange={() => set({ mode: "pattern" })} />
                  Repos by name pattern
                </label>
              </div>
              {f.mode === "repo" ? (
                repos.length ? (
                  <select aria-label="Repo" value={f.repoId} onChange={(e) => set({ repoId: e.target.value })} className={cn(SELECT, "pointer-coarse:h-11")}>
                    {repos.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                ) : (
                  <p className="text-sm text-muted-foreground">You don&apos;t own or administer any repos yet. Push an image first, or use a name pattern.</p>
                )
              ) : (
                <div className="grid gap-1.5">
                  <Input aria-label="Name pattern" value={f.pattern} onChange={(e) => set({ pattern: e.target.value })} placeholder="myteam/*" autoComplete="off" spellCheck={false} className="font-mono pointer-coarse:h-11" />
                  <p className="text-sm text-muted-foreground">Matches <span className="font-mono">namespace/name</span>. <span className="font-mono">*</span> is any characters, <span className="font-mono">?</span> one. Repos you can&apos;t administer are skipped.</p>
                </div>
              )}
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-keep`}>Keep the newest</Label>
                <Input id={`${id}-keep`} type="number" inputMode="numeric" min={1} max={1000} value={f.keepLast} onChange={(e) => set({ keepLast: e.target.value })} placeholder="All" className="tabular-nums pointer-coarse:h-11" />
                <p className="text-sm text-muted-foreground">tags per repo; older ones are removed.</p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-old`}>Delete tags older than</Label>
                <Input id={`${id}-old`} type="number" inputMode="numeric" min={1} max={3650} value={f.olderThanDays} onChange={(e) => set({ olderThanDays: e.target.value })} placeholder="Never" className="tabular-nums pointer-coarse:h-11" />
                <p className="text-sm text-muted-foreground">days since they were pushed.</p>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-re`}>Always keep tags matching (optional)</Label>
              <Input id={`${id}-re`} value={f.keepRegex} maxLength={100} onChange={(e) => set({ keepRegex: e.target.value })} placeholder="^v\d+\.\d+\.\d+$" autoComplete="off" spellCheck={false} className="font-mono pointer-coarse:h-11" />
              <p className="text-sm text-muted-foreground">A regular expression. Matching tags are never removed and don&apos;t count toward the newest.</p>
            </div>
            <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 rounded-lg border px-3 py-2.5 text-sm">
              <span className="grid gap-0.5">
                <span className="font-medium">Delete untagged images</span>
                <span className="text-muted-foreground">Images no tag points at, such as ones a newer push replaced.</span>
              </span>
              <Switch checked={f.deleteUntagged} onChange={(e) => set({ deleteUntagged: e.target.checked })} />
            </label>
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-every`}>Run</Label>
              <select id={`${id}-every`} value={f.intervalMin} onChange={(e) => set({ intervalMin: Number(e.target.value) })} className={cn(SELECT, "w-fit pointer-coarse:h-11")}>
                {INTERVALS.map(([m, l]) => <option key={m} value={m}>{l}</option>)}
                {!INTERVALS.some(([m]) => m === f.intervalMin) && <option value={f.intervalMin}>Every {every(f.intervalMin)}</option>}
              </select>
              <p className="text-sm text-muted-foreground">After each run, garbage collection frees blobs nothing uses.</p>
            </div>
            {preview && <PreviewPanel p={preview} />}
            <FormError>{error}</FormError>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className={TOUCH}
                disabled={!ready || checking || saving}
                onClick={() =>
                  check(async () => {
                    setError(undefined)
                    const r = await dryRun(toInput(f))
                    if ("error" in r && typeof r.error === "string") return setError(r.error)
                    setPreview(r as Preview)
                  })
                }
              >
                {checking && <CircleNotchIcon className="animate-spin motion-reduce:animate-none" />}
                Dry run
              </Button>
              <Dialog.Close disabled={saving} render={<Button type="button" variant="outline" className={TOUCH} />}>Cancel</Dialog.Close>
              <SubmitButton pending={saving} disabled={!ready} className={TOUCH}>{rule ? "Save" : "Add rule"}</SubmitButton>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Row({ r, onEdit }: { r: RuleView; onEdit: () => void }) {
  const setNotice = useNotice()
  const [pending, start] = useTransition()
  const act = (f: () => Promise<{ error?: string; removed?: number }>, ok: (r: { removed?: number }) => string) =>
    start(async () => {
      const res = await f()
      setNotice(res.error ? { text: res.error, error: true } : { text: ok(res) })
    })
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-3 sm:px-4">
      <div className="grid min-w-0 flex-1 basis-60 gap-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 truncate text-sm font-medium" title={r.name}>{r.name}</span>
          {r.running && <Badge variant="outline"><CircleNotchIcon className="animate-spin motion-reduce:animate-none" />Running</Badge>}
          {!r.running && r.lastStatus === "failed" && <Badge variant="outline" className="text-destructive"><WarningCircleIcon />Last run failed</Badge>}
          {!r.enabled && <Badge variant="secondary">Paused</Badge>}
        </div>
        <p className="truncate font-mono text-xs text-muted-foreground" title={r.scope}>{r.scope}</p>
        <p className="text-xs text-pretty text-muted-foreground" suppressHydrationWarning>
          {what(r)} · every {every(r.intervalMin)} · {r.lastRunAt ? `last ran ${ago(r.lastRunAt)}` : "not run yet"}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Switch aria-label={`${r.name} is on`} checked={r.enabled} disabled={pending} onChange={(e) => { const on = e.target.checked; act(() => setRuleEnabled(r.id, on), () => (on ? "Rule turned on." : "Rule paused.")) }} />
        <Button variant="outline" size="sm" className={TOUCH} disabled={pending || r.running} onClick={() => act(() => runRule(r.id), (x) => `Ran: ${plural(x.removed ?? 0, "item")} removed.`)}>
          {pending ? <CircleNotchIcon className="animate-spin motion-reduce:animate-none" /> : <PlayIcon />}
          Run now
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label={`Edit ${r.name}`} className="pointer-coarse:size-11" onClick={onEdit}><PencilSimpleIcon /></Button>
        <Confirm label="Delete" question="Delete this rule?" yes="Delete" pending={pending} onYes={() => act(() => deleteRule(r.id), () => "Rule deleted.")} />
      </div>
    </li>
  )
}

export function Rules({ rules, repos }: { rules: RuleView[]; repos: Repo[] }) {
  const [editing, setEditing] = useState<RuleView | "new" | null>(null)
  return (
    <section className="flex flex-col gap-4" aria-label="Cleanup rules">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">Each rule trims tags and untagged images on its schedule, then runs garbage collection. Try a rule with Dry run first.</p>
        <Button className={TOUCH} onClick={() => setEditing("new")}><PlusIcon />New rule</Button>
      </div>
      {rules.length === 0 ? (
        <Empty icon={BroomIcon} title="No cleanup rules yet">
          Keep your registry from growing forever: for example keep the newest 10 tags of a repo and delete untagged images.
          <Button variant="outline" className={TOUCH} onClick={() => setEditing("new")}><PlusIcon />Add your first rule</Button>
        </Empty>
      ) : (
        <ul className={LIST}>
          {rules.map((r) => <Row key={r.id} r={r} onEdit={() => setEditing(r)} />)}
        </ul>
      )}
      {editing && <Editor key={editing === "new" ? "new" : editing.id} rule={editing === "new" ? null : editing} repos={repos} open onClose={() => setEditing(null)} />}
    </section>
  )
}
