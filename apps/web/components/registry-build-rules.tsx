"use client"

import { Dialog } from "@base-ui/react/dialog"
import { Menu } from "@base-ui/react/menu"
import { CaretRightIcon, CheckCircleIcon, KeyIcon, PencilSimpleIcon, PlusIcon, TrashIcon, WarningIcon, XIcon } from "@phosphor-icons/react"
import { useEffect, useId, useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { buildSecretKeys, deleteRule, previewRule, saveRule } from "@/app/(app)/registry/build-actions"
import { ApiError, api, errorText } from "@/components/secrets/client"
import { DIALOG_BACKDROP, DIALOG_POPUP, MENU_ITEM } from "@/components/overlay-styles"
import { Empty, Heading, LIST, RowMenu, SECTION, SELECT, Segmented, Switch, TOUCH } from "@/components/registry-ui"
import { SafetyLine, useOutlook } from "@/components/registry-build-safety"
import { SubmitButton } from "@/components/submit-button"
import { useNotice } from "@/components/toaster"
import { FormError } from "@/components/two-factor"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { RuleInput } from "@/lib/registry/build-rules"
import { SCHEDULES, describeCron } from "@/lib/registry/build-view"
import { cn } from "@/lib/utils"

export type RuleView = RuleInput & { id: string; preview: string[] }

// Presets and platform names come from the page: the client never imports the server-side rules module.
export type PresetView = { id: string; label: string; rule: Pick<RuleInput, "sourceType" | "pattern" | "tags"> }

const BLANK: RuleInput = {
  sourceType: "branch",
  pattern: "main",
  tags: ["latest"],
  dockerfile: "Dockerfile",
  context: ".",
  buildArgs: [],
  secretRefs: [],
  platforms: [],
  failOnCritical: false,
  schedule: null,
  enabled: true,
}

const toInput = (r: RuleView): RuleInput => ({
  sourceType: r.sourceType,
  pattern: r.pattern,
  tags: r.tags,
  dockerfile: r.dockerfile,
  context: r.context,
  buildArgs: r.buildArgs,
  secretRefs: r.secretRefs,
  platforms: r.platforms,
  failOnCritical: r.failOnCritical,
  schedule: r.schedule,
  enabled: r.enabled,
})

const GRID = "lg:grid-cols-[4.5rem_minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)_5.5rem_7rem_5rem_2.5rem_2.25rem]"

export function RuleSection({
  repo,
  rules,
  presets,
  platforms,
  scanOn,
  arch,
}: {
  repo: { id: string; canAdmin: boolean; archived: boolean }
  rules: RuleView[]
  presets: PresetView[]
  platforms: string[]
  scanOn: boolean
  arch: string
}) {
  const [editing, setEditing] = useState<{ rule: RuleView | null; from?: PresetView } | null>(null)
  const canEdit = repo.canAdmin && !repo.archived
  return (
    <section className={SECTION} aria-labelledby="rules-heading">
      <Heading
        id="rules-heading"
        title="Build rules"
        hint="A push or tag that matches a rule builds the image and gives it the tags shown."
      >
        {canEdit && (
          <Button variant="outline" className={TOUCH} onClick={() => setEditing({ rule: null })}>
            <PlusIcon />
            Add rule
          </Button>
        )}
      </Heading>
      {rules.length === 0 ? (
        <Empty icon={PlusIcon} title="No rules yet">
          <p>A rule says which branch or tag to build, and what to call the image. Nothing builds on its own until there is one.</p>
          {canEdit ? (
            <div className="flex flex-wrap justify-center gap-2">
              {presets.map((p) => (
                <Button key={p.id} variant="outline" size="sm" className={TOUCH} onClick={() => setEditing({ rule: null, from: p })}>
                  {p.label}
                </Button>
              ))}
            </div>
          ) : (
            <p>A repository admin can add one.</p>
          )}
        </Empty>
      ) : (
        <div role="table" aria-label="Build rules" className={LIST}>
          <div role="row" className={cn("hidden gap-x-3 border-b bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground lg:grid", GRID)}>
            <span role="columnheader">Type</span>
            <span role="columnheader">Source</span>
            <span role="columnheader">Image tags</span>
            <span role="columnheader">Dockerfile</span>
            <span role="columnheader">Platforms</span>
            <span role="columnheader">Scan gate</span>
            <span role="columnheader">Schedule</span>
            <span role="columnheader">On</span>
            <span role="columnheader">
              <span className="sr-only">Actions</span>
            </span>
          </div>
          <ul role="rowgroup" className="divide-y">
            {rules.map((r) => (
              <RuleRow key={`${r.id}:${r.enabled}`} repoId={repo.id} rule={r} canEdit={canEdit} scanOn={scanOn} onEdit={() => setEditing({ rule: r })} />
            ))}
          </ul>
        </div>
      )}
      {editing && (
        <RuleEditor
          key={editing.rule?.id ?? editing.from?.id ?? "new"}
          repoId={repo.id}
          rule={editing.rule}
          from={editing.from}
          presets={presets}
          platforms={platforms}
          scanOn={scanOn}
          arch={arch}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  )
}

function RuleRow({ repoId, rule, canEdit, scanOn, onEdit }: { repoId: string; rule: RuleView; canEdit: boolean; scanOn: boolean; onEdit: () => void }) {
  const router = useRouter()
  const setNotice = useNotice()
  const [on, setOn] = useState(rule.enabled)
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()
  const { id, preview, ...input } = rule
  const cell = "min-w-0 text-xs text-muted-foreground lg:text-sm"
  return (
    <li role="row" className={cn("grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-2 px-4 py-3 lg:grid-cols-none", GRID, !on && "opacity-70")}>
      <div className="flex min-w-0 flex-wrap items-center gap-2 lg:contents">
        <div role="cell">
          <span className="sr-only lg:hidden">Type: </span>
          <Badge variant="outline" className="w-fit">
            {rule.sourceType === "branch" ? "Branch" : "Tag"}
          </Badge>
        </div>
        <div role="cell" className="min-w-0 font-mono text-sm break-all" title={rule.pattern}>
          {rule.pattern}
        </div>
      </div>
      <div role="cell" className="order-last col-span-full flex min-w-0 flex-wrap gap-1.5 lg:order-none lg:col-span-1">
        <span className="sr-only lg:hidden">Image tags: </span>
        {(preview.length ? preview : rule.tags).map((t) => (
          <Badge key={t} variant="outline" className="font-mono">
            {t}
          </Badge>
        ))}
      </div>
      <p role="cell" className={cn(cell, "order-last col-span-full break-all lg:order-none lg:col-span-1")}>
        <span className="sr-only lg:hidden">Dockerfile: </span>
        <span className="font-mono">{rule.dockerfile}</span>
        {rule.context !== "." && <span className="block text-xs">in {rule.context}</span>}
      </p>
      <p role="cell" className={cn(cell, "order-last col-span-full lg:order-none lg:col-span-1")} title={rule.platforms.join(", ")}>
        <span className="lg:hidden">Platforms: </span>
        {rule.platforms.length === 0 ? "This server" : rule.platforms.map((p) => p.replace("linux/", "")).join(", ")}
      </p>
      <p role="cell" className={cn(cell, "order-last col-span-full lg:order-none lg:col-span-1", rule.failOnCritical && !scanOn && "text-warning")}>
        <span className="lg:hidden">Scan gate: </span>
        {rule.failOnCritical ? (scanOn ? "On" : "On (scanning is off)") : "Off"}
      </p>
      <p role="cell" className={cn(cell, "order-last col-span-full lg:order-none lg:col-span-1")}>
        <span className="lg:hidden">Schedule: </span>
        {describeCron(rule.schedule).replace("Every day at ", "Daily ")}
      </p>
      <div role="cell" className="justify-self-end">
      <Switch
        aria-label={`Rule for ${rule.pattern} is on`}
        checked={on}
        disabled={!canEdit || pending}
        onChange={(e) => {
          const next = e.currentTarget.checked
          setOn(next)
          start(async () => {
            const r = await saveRule(repoId, id, { ...input, enabled: next })
            if (r.error) {
              setOn(!next)
              setNotice({ text: r.error })
            } else router.refresh()
          })
        }}
      />
      </div>
      <div role="cell">
      {canEdit ? (
        <RowMenu label={`More for the ${rule.pattern} rule`}>
          <Menu.Item className={MENU_ITEM} onClick={onEdit}>
            <PencilSimpleIcon />
            Edit
          </Menu.Item>
          <Menu.Item className={cn(MENU_ITEM, "text-destructive [&_svg]:text-destructive")} onClick={() => setAsking(true)}>
            <TrashIcon />
            Delete
          </Menu.Item>
        </RowMenu>
      ) : (
        <span />
      )}
      </div>
      <Dialog.Root open={asking} onOpenChange={(o) => !o && !pending && setAsking(false)}>
        <Dialog.Portal>
          <Dialog.Backdrop className={DIALOG_BACKDROP} />
          <Dialog.Popup className={DIALOG_POPUP}>
            <div className="grid gap-1.5">
              <Dialog.Title className="text-base font-semibold">Delete this rule?</Dialog.Title>
              <Dialog.Description className="text-sm text-pretty text-muted-foreground">
                {rule.sourceType === "branch" ? "Branch" : "Tag"} <span className="font-mono">{rule.pattern}</span> stops building. Past builds and images stay.
              </Dialog.Description>
            </div>
            <FormError>{error}</FormError>
            <div className="flex justify-end gap-2">
              <Dialog.Close disabled={pending} render={<Button variant="outline" className={TOUCH} />}>
                Keep
              </Dialog.Close>
              <Button
                variant="destructive"
                className={TOUCH}
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await deleteRule(id)
                    if (r.error) return setError(r.error)
                    setAsking(false)
                    setNotice({ text: "Rule deleted." })
                    router.refresh()
                  })
                }
              >
                Delete rule
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </li>
  )
}

// ---- the editor --------------------------------------------------------------------------------------------

const FIELD = "grid gap-1.5"
const HELP = "text-xs text-pretty text-muted-foreground"
const GROUP = "grid gap-3 border-t pt-4"
const TEMPLATES = ["latest", "{branch}", "{sha}", "{tag}", "{version}", "{major}.{minor}", "{major}"]

function RuleEditor({
  repoId,
  rule,
  from,
  presets,
  platforms,
  scanOn,
  arch,
  onClose,
}: {
  repoId: string
  rule: RuleView | null
  from?: PresetView
  presets: PresetView[]
  platforms: string[]
  scanOn: boolean
  arch: string
  onClose: () => void
}) {
  const router = useRouter()
  const setNotice = useNotice()
  const id = useId()
  const start0: RuleInput = rule ? toInput(rule) : { ...BLANK, ...(from?.rule ?? {}) }
  const [d, setD] = useState<RuleInput>(start0)
  const [tagText, setTagText] = useState("")
  const [custom, setCustom] = useState(Boolean(start0.schedule) && !SCHEDULES.some(([v]) => v === start0.schedule))
  const [sample, setSample] = useState(start0.sourceType === "tag" ? "v1.2.3" : start0.pattern.startsWith("re:") || /[*?,]/.test(start0.pattern) ? "main" : start0.pattern)
  const [probe, setProbe] = useState<{ matches: boolean; tags: string[] } | null>(null)
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()
  const [said, setSaid] = useState("")
  const [more, setMore] = useState(() => start0.platforms.some((p) => p !== arch))
  const outlook = useOutlook(true)
  const [advanced, setAdvanced] = useState(() => Boolean(start0.buildArgs.length || start0.secretRefs.length || start0.platforms.length || start0.schedule))
  const set = <K extends keyof RuleInput>(k: K, v: RuleInput[K]) => setD((x) => ({ ...x, [k]: v }))

  // "Does this name match, and what would it be tagged": asked of the server, which owns the matching code.
  useEffect(() => {
    let live = true
    const t = setTimeout(async () => {
      const r = await previewRule({ sourceType: d.sourceType, pattern: d.pattern, tags: d.tags, sample }).catch(() => null)
      if (live) setProbe(r)
    }, 250)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [d.sourceType, d.pattern, d.tags, sample])

  const addTag = (raw: string) => {
    const t = raw.trim().replace(/,$/, "")
    if (!t || d.tags.includes(t)) return setTagText("")
    set("tags", [...d.tags, t])
    setSaid(`Added ${t}`)
    setTagText("")
  }
  const removeTag = (t: string) => {
    set("tags", d.tags.filter((x) => x !== t))
    setSaid(`Removed ${t}`)
  }
  const foreign = d.platforms.filter((p) => p !== arch).length
  const schedule = d.schedule ?? ""
  const literal = !d.pattern.startsWith("re:") && !/[*?,]/.test(d.pattern)

  return (
    <Dialog.Root open onOpenChange={(o) => !o && !pending && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={cn(DIALOG_POPUP, "max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto")}>
          <div className="grid gap-1.5">
            <Dialog.Title className="text-base font-semibold">{rule ? "Edit build rule" : "Add a build rule"}</Dialog.Title>
            <Dialog.Description className="text-sm text-pretty text-muted-foreground">
              Pick what triggers a build, what the image is called, and how it is built.
            </Dialog.Description>
          </div>
          <form
            className="grid gap-5"
            onSubmit={(e) => {
              e.preventDefault()
              start(async () => {
                setError(undefined)
                const r = await saveRule(repoId, rule?.id ?? null, d)
                if (r.error) return setError(r.error)
                setNotice({ text: rule ? "Rule saved." : "Rule added." })
                onClose()
                router.refresh()
              })
            }}
          >
            {!rule && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Start from:</span>
                {presets.map((p) => {
                  const on = p.rule.sourceType === d.sourceType && p.rule.pattern === d.pattern && p.rule.tags.join("\n") === d.tags.join("\n")
                  return (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setD((x) => ({ ...x, ...p.rule }))}
                      className="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:min-h-11"
                    >
                      <Badge variant="outline" className={cn("hover:bg-accent", on && "border-ring/60 bg-input/30")}>
                        {on && <CheckCircleIcon aria-hidden weight="fill" className="text-brand" />}
                        {p.label}
                      </Badge>
                    </button>
                  )
                })}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
              <div className={FIELD}>
                <span className="text-sm font-medium">Build on</span>
                <Segmented
                  label="Build on"
                  value={d.sourceType}
                  options={[
                    ["branch", "Branch"],
                    ["tag", "Tag"],
                  ]}
                  onChange={(v) => {
                    set("sourceType", v)
                    setSample(v === "tag" ? "v1.2.3" : "main")
                  }}
                />
              </div>
              <div className={FIELD}>
                <Label htmlFor={`${id}-pat`}>{d.sourceType === "branch" ? "Branch" : "Tag"} pattern</Label>
                <Input
                  id={`${id}-pat`}
                  value={d.pattern}
                  onChange={(e) => set("pattern", e.target.value)}
                  className="font-mono pointer-coarse:h-11"
                  placeholder={d.sourceType === "branch" ? "main" : "re:^v\\d+\\.\\d+\\.\\d+$"}
                  spellCheck={false}
                  autoComplete="off"
                />
                <p className={HELP}>
                  A name, or a pattern: <span className="font-mono">release/*</span>, several with commas, or <span className="font-mono">re:</span> and a regular expression.
                </p>
              </div>
            </div>

            <div className="grid gap-2 rounded-lg bg-input/20 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Label htmlFor={`${id}-sample`} className="text-xs">
                  Try {d.sourceType === "branch" ? "a branch" : "a tag"}
                </Label>
                <Input id={`${id}-sample`} value={sample} onChange={(e) => setSample(e.target.value)} className="h-8 w-40 font-mono text-xs pointer-coarse:h-11" spellCheck={false} autoComplete="off" />
                <span aria-live="polite" className="flex items-center gap-1 text-sm">
                  {probe &&
                    (probe.matches ? (
                      <>
                        <CheckCircleIcon aria-hidden weight="fill" className="size-4 text-brand" />
                        Matches
                      </>
                    ) : (
                      <>
                        <XIcon aria-hidden className="size-4 text-muted-foreground" />
                        <span className="text-muted-foreground">Doesn&apos;t match</span>
                      </>
                    ))}
                </span>
              </div>
              {probe?.matches && (
                <p className="text-xs text-muted-foreground">
                  It would be tagged{" "}
                  {probe.tags.length ? probe.tags.map((t) => (
                    <span key={t} className="mr-1 font-mono text-foreground">
                      {t}
                    </span>
                  )) : "nothing (no tag template fits this name)"}
                </p>
              )}
            </div>

            <div className={FIELD}>
              <Label htmlFor={`${id}-tag`}>Image tags</Label>
              <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-input/20 p-1.5 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
                {d.tags.map((t) => (
                  <Badge key={t} variant="outline" className="gap-1 pr-1 font-mono">
                    {t}
                    <button type="button" aria-label={`Remove ${t}`} onClick={() => removeTag(t)} className="grid size-4 place-items-center rounded-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:size-11">
                      <XIcon className="size-3" />
                    </button>
                  </Badge>
                ))}
                <input
                  id={`${id}-tag`}
                  value={tagText}
                  onChange={(e) => (e.target.value.endsWith(",") ? addTag(e.target.value) : setTagText(e.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      addTag(tagText)
                    } else if (e.key === "Backspace" && !tagText && d.tags.length) removeTag(d.tags[d.tags.length - 1])
                  }}
                  onBlur={() => tagText && addTag(tagText)}
                  placeholder={d.tags.length ? "" : "latest"}
                  className="h-7 min-w-24 flex-1 bg-transparent px-1.5 font-mono text-sm outline-none pointer-coarse:h-10"
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Add:</span>
                {TEMPLATES.filter((t) => !d.tags.includes(t)).map((t) => (
                  <button key={t} type="button" aria-label={`Add ${t}`} onClick={() => (set("tags", [...d.tags, t]), setSaid(`Added ${t}`))} className="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:min-h-11">
                    <Badge variant="outline" className="font-mono hover:bg-accent">
                      {t}
                    </Badge>
                  </button>
                ))}
              </div>
              <p role="status" className="sr-only">
                {said}
              </p>
              <p className={HELP}>
                <span className="font-mono">{"{branch}"}</span> the branch, <span className="font-mono">{"{sha}"}</span> the short commit, <span className="font-mono">{"{tag}"}</span> the git tag,{" "}
                <span className="font-mono">{"{version}"}</span> 1.2.3 from v1.2.3, <span className="font-mono">{"{major}.{minor}"}</span> 1.2, <span className="font-mono">{"{major}"}</span> 1. A tag that
                doesn&apos;t apply is skipped.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className={FIELD}>
                <Label htmlFor={`${id}-df`}>Dockerfile</Label>
                <Input id={`${id}-df`} value={d.dockerfile} onChange={(e) => set("dockerfile", e.target.value)} className="font-mono pointer-coarse:h-11" spellCheck={false} autoComplete="off" />
              </div>
              <div className={FIELD}>
                <Label htmlFor={`${id}-ctx`}>Context folder</Label>
                <Input id={`${id}-ctx`} value={d.context} onChange={(e) => set("context", e.target.value)} className="font-mono pointer-coarse:h-11" spellCheck={false} autoComplete="off" />
              </div>
            </div>

            <div className={GROUP}>
              <label className="flex min-h-11 items-center justify-between gap-4">
                <span className="grid gap-0.5">
                  <span className="text-sm font-semibold">Scan gate: fail the build on critical vulnerabilities</span>
                  <span className={HELP}>{scanOn ? "The image is scanned before it is tagged. A Critical finding fails the build and nothing is tagged." : "Turn on image scanning in setup to use this."}</span>
                </span>
                <Switch aria-label="Scan gate: fail the build on critical vulnerabilities" checked={d.failOnCritical && scanOn} disabled={!scanOn} onChange={(e) => set("failOnCritical", e.currentTarget.checked)} />
              </label>
            </div>

            <details className="group grid gap-5 border-t pt-2" open={advanced} onToggle={(e) => setAdvanced(e.currentTarget.open)}>
              <summary className="flex min-h-11 w-fit cursor-pointer items-center gap-1.5 rounded-md text-sm font-semibold outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                <CaretRightIcon aria-hidden className="size-3.5 transition-transform group-open:rotate-90 motion-reduce:transition-none" />
                Advanced
                <span className="font-normal text-muted-foreground">build arguments, secrets, platforms, schedule</span>
              </summary>
            <div className="grid gap-3">
              <div className="grid gap-0.5">
                <h3 className="text-sm font-semibold">Build arguments</h3>
                <p className={HELP}>Plain values passed as ARG. Anything private belongs in a build secret below.</p>
              </div>
              {d.buildArgs.map((a, i) => (
                <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] gap-2">
                  <Input aria-label={`Argument ${i + 1} name`} value={a.key} placeholder="NAME" className="font-mono pointer-coarse:h-11" spellCheck={false} onChange={(e) => set("buildArgs", d.buildArgs.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} />
                  <Input aria-label={`Argument ${i + 1} value`} value={a.value} placeholder="value" className="font-mono pointer-coarse:h-11" spellCheck={false} onChange={(e) => set("buildArgs", d.buildArgs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove argument ${i + 1}`} className="pointer-coarse:size-11" onClick={() => set("buildArgs", d.buildArgs.filter((_, j) => j !== i))}>
                    <XIcon />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" className={cn("w-fit", TOUCH)} onClick={() => set("buildArgs", [...d.buildArgs, { key: "", value: "" }])}>
                <PlusIcon />
                Add argument
              </Button>
            </div>

            <SecretRefs refs={d.secretRefs} onChange={(v) => set("secretRefs", v)} />

            <div className={GROUP}>
              <div className="grid gap-0.5">
                <h3 className="text-sm font-semibold">Platforms</h3>
                <p className={HELP}>Nothing ticked builds for this server ({arch}). Other platforms are emulated and much slower.</p>
              </div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                <PlatformBox p={arch} d={d} set={set} />
              </div>
              <details className="group grid gap-1.5" open={more} onToggle={(e) => setMore(e.currentTarget.open)}>
                <summary className="flex min-h-11 w-fit cursor-pointer items-center gap-1 rounded-md text-sm font-medium outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-h-8">
                  <CaretRightIcon aria-hidden className="size-3.5 transition-transform group-open:rotate-90 motion-reduce:transition-none" />
                  More platforms (emulated, slower)
                </summary>
                <div className="grid gap-1.5 pt-1.5 sm:grid-cols-2">
                  {platforms.filter((p) => p !== arch).map((p) => (
                    <PlatformBox key={p} p={p} d={d} set={set} foreign />
                  ))}
                </div>
              </details>
              {foreign > 2 && (
                <p role="status" className="flex items-start gap-2 text-sm text-pretty">
                  <WarningIcon aria-hidden weight="fill" className="mt-0.5 size-4 shrink-0 text-warning" />
                  Each emulated platform can take several times longer than a build for this server, and uses the same memory.
                </p>
              )}
            </div>

            <div className={GROUP}>
              <div className="grid gap-2">
                <span className="text-sm font-semibold">Schedule</span>
                <Segmented
                  label="Schedule"
                  value={custom ? "custom" : schedule}
                  options={[...SCHEDULES, ["custom", "Custom"]] as const}
                  onChange={(v) => {
                    if (v === "custom") return setCustom(true)
                    setCustom(false)
                    set("schedule", v || null)
                  }}
                />
                {custom && (
                  <div className={FIELD}>
                    <Label htmlFor={`${id}-cron`} className="sr-only">
                      Cron schedule
                    </Label>
                    <Input id={`${id}-cron`} value={schedule} onChange={(e) => set("schedule", e.target.value || null)} placeholder="0 3 * * *" className="w-48 font-mono pointer-coarse:h-11" spellCheck={false} autoComplete="off" />
                  </div>
                )}
                <p className={HELP} aria-live="polite">
                  {d.schedule ? `${describeCron(d.schedule)}, server time. ` : "Rebuilds on a timer, for fresh base images. "}
                  {d.schedule && !literal ? "A schedule needs a plain branch or tag name above, not a pattern." : ""}
                </p>
              </div>
            </div>

            </details>

            <div className={GROUP}>
              <label className="flex min-h-11 items-center justify-between gap-4">
                <span className="text-sm font-semibold">Rule is on</span>
                <Switch aria-label="Rule is on" checked={d.enabled} onChange={(e) => set("enabled", e.currentTarget.checked)} />
              </label>
            </div>

            <FormError>{error}</FormError>
            <div className="sticky -bottom-6 -mx-6 -mb-6 grid gap-2 border-t bg-popover px-6 pt-3 pb-6">
              <SafetyLine o={outlook} />
              <div className="flex justify-end gap-2">
                <Dialog.Close disabled={pending} render={<Button type="button" variant="outline" className={TOUCH} />}>
                  Cancel
                </Dialog.Close>
                <SubmitButton pending={pending} className={TOUCH}>
                  {rule ? "Save rule" : "Add rule"}
                </SubmitButton>
              </div>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function PlatformBox({ p, d, set, foreign }: { p: string; d: RuleInput; set: <K extends keyof RuleInput>(k: K, v: RuleInput[K]) => void; foreign?: boolean }) {
  const on = d.platforms.includes(p)
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm has-checked:border-ring/60 has-checked:bg-input/30">
      <input type="checkbox" className="size-4 shrink-0 accent-primary" checked={on} onChange={() => set("platforms", on ? d.platforms.filter((x) => x !== p) : [...d.platforms, p])} />
      <span className="min-w-0 flex-1">
        <span className="font-mono">{p}</span>
        <span className="block text-xs text-muted-foreground">{foreign ? "emulated, slower" : "this server"}</span>
      </span>
    </label>
  )
}

// ---- build secrets: references into Nimbus Secrets, never values --------------------------------------------

type Project = { id: string; name: string; role: string }
type Env = { id: string; name: string }
type Ref = RuleInput["secretRefs"][number]

function SecretRefs({ refs, onChange }: { refs: Ref[]; onChange: (v: Ref[]) => void }) {
  const id = useId()
  const [adding, setAdding] = useState(false)
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [locked, setLocked] = useState(false)
  const [project, setProject] = useState("")
  const [envList, setEnvList] = useState<{ project: string; envs: Env[] } | null>(null)
  const [env, setEnv] = useState("")
  const [keyList, setKeyList] = useState<{ env: string; keys: { id: string; key: string }[] } | null>(null)
  const [key, setKey] = useState("")
  const [error, setError] = useState<string>()

  // Answers only ever arrive in callbacks, so nothing here sets state while an effect runs.
  const load = () =>
    api<{ projects: Project[] }>("/projects").then(
      (r) => {
        setProjects(r.projects)
        setProject((p) => p || r.projects[0]?.id || "")
      },
      (e) => {
        if (e instanceof ApiError && e.status === 423) setLocked(true)
        else setError(errorText(e))
        setProjects([])
      }
    )
  const retry = () => {
    setError(undefined)
    setLocked(false)
    setProjects(null)
    load()
  }
  useEffect(() => {
    if ((adding || refs.length) && projects === null) load()
  }, [adding, refs.length, projects])
  useEffect(() => {
    if (!project || !adding) return
    let live = true
    api<{ envs: Env[] }>(`/projects/${project}`).then(
      (r) => {
        if (!live) return
        setEnvList({ project, envs: r.envs })
        setEnv(r.envs[0]?.id ?? "")
      },
      (e) => live && setError(errorText(e))
    )
    return () => {
      live = false
    }
  }, [project, adding])
  useEffect(() => {
    if (!project || !env) return
    let live = true
    buildSecretKeys(project, env).then((r) => {
      if (!live) return
      if (r.locked) return setLocked(true)
      if (r.error) return setError(r.error)
      setKeyList({ env, keys: r.keys ?? [] })
      setKey(r.keys?.[0]?.id ?? "")
    })
    return () => {
      live = false
    }
  }, [project, env])
  const envs = envList?.project === project ? envList.envs : []
  const keys = keyList?.env === env ? keyList.keys : []

  const projectName = (pid: string) => projects?.find((p) => p.id === pid)?.name
  return (
    <div className={GROUP}>
      <div className="grid gap-0.5">
        <h3 className="text-sm font-semibold">Build secrets</h3>
        <p className={HELP}>
          Secrets from Nimbus Secrets, available to RUN steps with <span className="font-mono">--mount=type=secret,id=NAME</span>. Only the reference is saved here, never the value, and the log hides it.
        </p>
      </div>
      {refs.length > 0 && (
        <ul className="divide-y overflow-hidden rounded-lg border">
          {refs.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-3 py-2">
              <KeyIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 text-sm">
                <span className="font-mono">{r.key}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {projectName(r.projectId) ?? "Secrets project"} · {r.env}
                </span>
              </span>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove secret ${r.key}`} className="pointer-coarse:size-11" onClick={() => onChange(refs.filter((x) => x.id !== r.id || x.key !== r.key))}>
                <XIcon />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <div className="grid gap-3 rounded-lg border p-3">
          {locked ? (
            <div className="grid gap-2 text-sm text-pretty text-muted-foreground">
              <p>Secrets is locked. Unlock it, then try again. Your rule stays open.</p>
              <div className="flex flex-wrap gap-2">
                <a href="/secrets" target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: "outline", size: "sm" }), TOUCH)}>
                  Open Secrets
                </a>
                <Button type="button" variant="ghost" size="sm" className={TOUCH} onClick={retry}>
                  Try again
                </Button>
              </div>
            </div>
          ) : projects === null ? (
            <p className="text-sm text-muted-foreground">Loading projects…</p>
          ) : projects.length === 0 ? (
            <FormError>{error ?? "You have no Secrets project to take secrets from."}</FormError>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className={FIELD}>
                <Label htmlFor={`${id}-p`}>Project</Label>
                <select id={`${id}-p`} value={project} onChange={(e) => setProject(e.target.value)} className={cn(SELECT, "pointer-coarse:h-11")}>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className={FIELD}>
                <Label htmlFor={`${id}-e`}>Environment</Label>
                <select id={`${id}-e`} value={env} onChange={(e) => setEnv(e.target.value)} className={cn(SELECT, "pointer-coarse:h-11")}>
                  {envs.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className={FIELD}>
                <Label htmlFor={`${id}-k`}>Secret</Label>
                <select id={`${id}-k`} value={key} onChange={(e) => setKey(e.target.value)} className={cn(SELECT, "font-mono pointer-coarse:h-11")} disabled={!keys.length}>
                  {keys.length === 0 && <option value="">None in this environment</option>}
                  {keys.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.key}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
          <FormError>{!locked && projects?.length ? error : undefined}</FormError>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              className={TOUCH}
              disabled={!key || locked}
              onClick={() => {
                const k = keys.find((x) => x.id === key)
                const e = envs.find((x) => x.id === env)
                if (!k || !e) return
                if (refs.some((r) => r.key === k.key)) return setError(`A secret called ${k.key} is already added.`)
                onChange([...refs, { id: k.id, projectId: project, env: e.name, key: k.key }])
                setAdding(false)
              }}
            >
              Add secret
            </Button>
            <Button type="button" variant="ghost" size="sm" className={TOUCH} onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="outline" size="sm" className={cn("w-fit", TOUCH)} onClick={() => setAdding(true)}>
          <PlusIcon />
          Add secret
        </Button>
      )}
    </div>
  )
}
