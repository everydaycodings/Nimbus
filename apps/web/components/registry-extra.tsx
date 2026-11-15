"use client"

import { Dialog } from "@base-ui/react/dialog"
import {
  ArrowCounterClockwiseIcon,
  BroomIcon,
  ClockCounterClockwiseIcon,
  CubeIcon,
  GitBranchIcon,
  PackageIcon,
  PaperPlaneTiltIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import Link from "next/link"
import { useEffect, useId, useState, useTransition } from "react"

import {
  activityPage,
  addHook,
  hookLog,
  namespaceSettings,
  previewCleanup,
  purgeTrashItem,
  removeHook,
  repoHooks,
  restoreTrash,
  runCleanup,
  runNamespaceCleanup,
  saveNamespacePolicy,
  saveRepoPolicy,
  sendTestHook,
  toggleHook,
  type Preview,
} from "@/app/(app)/registry/actions"
import { CopyButton } from "@/components/copy-button"
import { ActivityList, type ActivityPage } from "@/components/registry-activity"
import { DIALOG_BACKDROP, DIALOG_POPUP } from "@/components/overlay-styles"
import { Code, Confirm, Empty, Heading, LIST, SECTION, Switch, TOUCH, WHEN } from "@/components/registry-ui"
import { SubmitButton } from "@/components/submit-button"
import { useNotice } from "@/components/toaster"
import { FormError } from "@/components/two-factor"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { sizeOf } from "@/lib/registry/size"
import type { CachedRepo, DeliveryRow, HookRow, OwnedNamespace, RepoRow, TrashRow } from "@/lib/registry/manage"
import type { Policy } from "@/lib/registry/rules"
import { cn } from "@/lib/utils"

// ---- Tabs ----------------------------------------------------------------

export type Tab = "repos" | "access" | "trash" | "mirrors"

export function RegistryTabs({ tab, trash }: { tab: Tab; trash: number }) {
  const items: [Tab, string, string][] = [
    ["repos", "Repositories", "/registry"],
    ["access", "Access", "/registry?tab=access"],
    ["trash", trash ? `Trash (${trash})` : "Trash", "/registry?tab=trash"],
    ["mirrors", "Mirrors", "/registry?tab=mirrors"],
  ]
  return (
    <nav aria-label="Registry sections" className="flex w-fit max-w-full overflow-x-auto rounded-lg bg-muted p-[3px]">
      {items.map(([id, label, href]) => (
        <Link
          key={id}
          href={href}
          aria-current={tab === id ? "page" : undefined}
          className="flex h-7 items-center rounded-md border border-transparent px-3 text-sm whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:h-11 aria-[current=page]:border-input aria-[current=page]:bg-input/30 aria-[current=page]:text-foreground"
        >
          {label}
        </Link>
      ))}
    </nav>
  )
}

// ---- Trash ---------------------------------------------------------------

const KIND_ICON = { repo: PackageIcon, tag: GitBranchIcon, manifest: CubeIcon }

export function TrashTab({ rows, days }: { rows: TrashRow[]; days: number }) {
  return (
    <section className={SECTION} aria-label="Trash">
      <p className="max-w-prose text-sm text-pretty text-muted-foreground">
        {`Deleted repositories and tags stay here for ${days} days, then they are removed for good. Restore brings one back as it was.`}
      </p>
      {rows.length === 0 ? (
        <Empty icon={TrashIcon} title="Trash is empty">
          Deleted repositories and tags show up here until they are purged.
        </Empty>
      ) : (
        <ul className={LIST}>
          {rows.map((r) => (
            <TrashItem key={`${r.kind}-${r.id}`} r={r} />
          ))}
        </ul>
      )}
    </section>
  )
}

function TrashItem({ r }: { r: TrashRow }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string>()
  const [rename, setRename] = useState<string | null>(null)
  const setNotice = useNotice()
  const Icon = KIND_ICON[r.kind]
  const restore = (as?: string) =>
    start(async () => {
      setError(undefined)
      const res = await restoreTrash(r.kind, r.id, as)
      if (res.error) {
        if ("conflict" in res && res.conflict && rename === null) setRename(`${r.label}-restored`)
        return setError(res.error)
      }
      setRename(null)
      setNotice({ text: `Restored “${as ?? r.label}”.` })
    })
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Icon className="size-5 shrink-0 text-muted-foreground" />
        <div className="grid min-w-0 flex-1 basis-56 gap-0.5">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <span className="font-mono break-all">{r.label}</span>
            <Badge variant="outline">{r.kind === "repo" ? "Repository" : r.kind === "tag" ? "Tag" : "Untagged"}</Badge>
          </p>
          <p suppressHydrationWarning className="text-xs text-pretty text-muted-foreground">
            {r.kind !== "repo" && (
              <>
                <span className="font-mono">{r.repo}</span> ·{" "}
              </>
            )}
            Deleted {WHEN.format(new Date(r.deletedAt))} ·{" "}
            <span className={cn(r.daysLeft <= 1 && "text-destructive")}>
              {r.daysLeft === 0 ? "Purged within a day" : r.daysLeft === 1 ? "1 day left" : `${r.daysLeft} days left`}
            </span>
          </p>
        </div>
        <Button variant="outline" size="sm" className={TOUCH} disabled={pending} onClick={() => restore()}>
          <ArrowCounterClockwiseIcon />
          Restore
        </Button>
        <Confirm
          label="Delete forever"
          question="This can't be undone."
          yes="Delete forever"
          pending={pending}
          onYes={() =>
            start(async () => {
              const res = await purgeTrashItem(r.kind, r.id)
              if (res.error) return setError(res.error)
              setNotice({ text: `Deleted “${r.label}” for good.` })
            })
          }
        />
      </div>
      {rename !== null && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            restore(rename)
          }}
        >
          <Input
            aria-label="Restore as"
            value={rename}
            onChange={(e) => setRename(e.target.value)}
            maxLength={128}
            autoFocus
            className="max-w-64 font-mono"
          />
          <SubmitButton pending={pending} variant="outline" size="sm" className={TOUCH}>
            Restore as
          </SubmitButton>
          <Button type="button" variant="ghost" size="sm" className={TOUCH} onClick={() => setRename(null)}>
            Cancel
          </Button>
        </form>
      )}
      <FormError>{error}</FormError>
    </li>
  )
}

// ---- Mirrors (read-only for members) --------------------------------------

const SAMPLE: Record<string, string> = { dockerhub: "library/nginx", ghcr: "<owner>/<image>", quay: "<org>/<image>" }

export function MirrorsTab({
  host,
  upstreams,
  cached,
}: {
  host: string
  upstreams: { name: string; url: string; ttlDays: number }[]
  cached: CachedRepo[]
}) {
  return (
    <>
      <section className={SECTION} aria-label="Mirrors">
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">
          Pull public images through Nimbus. The first pull fetches and keeps a copy; later pulls come from here.
        </p>
        {upstreams.length === 0 ? (
          <Empty icon={PackageIcon} title="No mirrors yet">
            An admin sets up mirrors for Docker Hub, GitHub and others under Admin → Container registry.
          </Empty>
        ) : (
          <ul className={LIST}>
            {upstreams.map((u) => {
              const pull = `docker pull ${host}/mirror/${u.name}/${SAMPLE[u.name] ?? "<repo>"}${u.name in SAMPLE ? ":latest" : ":<tag>"}`
              return (
                <li key={u.name} className="flex flex-col gap-2 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-mono text-sm font-medium">{u.name}</span>
                    <span className="min-w-0 text-xs text-muted-foreground">
                      <span className="break-all">{u.url}</span> · Kept {u.ttlDays === 1 ? "1 day" : `${u.ttlDays} days`} after the last pull
                    </span>
                  </div>
                  <div className="relative">
                    <Code copy>{pull}</Code>
                    <div className="absolute top-2 right-2">
                      <CopyButton value={pull} />
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
      <section className={SECTION} aria-labelledby="cached-heading">
        <Heading id="cached-heading" title="Cached images" hint="Copies already stored here. They expire when nobody pulls them." />
        {cached.length === 0 ? (
          <Empty icon={CubeIcon} title="Nothing cached yet">
            Pull an image through a mirror and it appears here.
          </Empty>
        ) : (
          <ul className={LIST}>
            {cached.map((c) => (
              <li key={c.fullName} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                <span className="min-w-0 flex-1 basis-56 font-mono text-sm break-all">{c.fullName}</span>
                <span suppressHydrationWarning className="text-xs text-muted-foreground">
                  {c.tags === 1 ? "1 tag" : `${c.tags} tags`} · <span className="tabular-nums">{sizeOf(c.bytes)}</span> ·{" "}
                  {c.lastPulledAt ? `Last pulled ${WHEN.format(new Date(c.lastPulledAt))}` : "Never pulled"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

// ---- Cleanup policy --------------------------------------------------------

type Form = { keepLast: string; untaggedDays: string; keepPattern: string; deletePattern: string; notPulledDays: string }

const toForm = (p: Policy | null): Form => ({
  keepLast: p?.keepLast ? String(p.keepLast) : "",
  untaggedDays: p?.untaggedDays ? String(p.untaggedDays) : "",
  keepPattern: p?.keepPattern ?? "",
  deletePattern: p?.deletePattern ?? "",
  notPulledDays: p?.notPulledDays ? String(p.notPulledDays) : "",
})

export function describePolicy(p: Policy | null) {
  if (!p) return "no cleanup"
  const parts = [
    p.keepLast && `keep newest ${p.keepLast}`,
    p.keepPattern && `keep ${p.keepPattern}`,
    p.deletePattern && `delete ${p.deletePattern}`,
    p.notPulledDays && `delete unpulled ${p.notPulledDays}d`,
    p.untaggedDays && `untagged ${p.untaggedDays}d`,
  ].filter(Boolean)
  return parts.join(", ")
}

const PATTERN_HELP = (
  <>
    A glob like <code className="font-mono">v*</code> or <code className="font-mono">dev-*,pr-*</code> (comma separated), or{" "}
    <code className="font-mono">re:^v\d+</code> for a regular expression.
  </>
)

// Cleanup rules for a namespace (the default for its repos) or one repo (inherit or override).
export function PolicyEditor({
  namespace,
  repo,
  initial,
  inherited,
}: {
  namespace: string
  // Full name; set for a repo override.
  repo?: string
  initial: Policy | null
  // The namespace default a repo would inherit.
  inherited?: Policy | null
}) {
  const id = useId()
  const [custom, setCustom] = useState(!repo || initial !== null)
  const [f, setF] = useState<Form>(toForm(initial))
  // What is stored, so Run now (which runs the stored rules) knows when the form has moved on.
  const [saved, setSaved] = useState({ custom: !repo || initial !== null, f: toForm(initial) })
  const dirty = custom !== saved.custom || (custom && JSON.stringify(f) !== JSON.stringify(saved.f))
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])
  const stored = repo && !saved.custom ? toForm(inherited ?? null) : saved.f
  const hasRules = Object.values(stored).some(Boolean)
  const [error, setError] = useState<string>()
  const [preview, setPreview] = useState<Preview | null>(null)
  const [pending, start] = useTransition()
  const setNotice = useNotice()
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setF({ ...f, [k]: e.target.value })
    setPreview(null)
  }
  const effective = repo && !custom ? toForm(inherited ?? null) : f
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        setError(undefined)
        start(async () => {
          const r = repo ? await saveRepoPolicy(repo, custom ? f : null) : await saveNamespacePolicy(namespace, f)
          if (r.error) return setError(r.error)
          setSaved({ custom, f })
          setNotice({ text: repo && !custom ? `Cleanup follows ${namespace} again.` : "Cleanup rules saved." })
        })
      }}
    >
      {repo && (
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Cleanup rules for this repository">
          {[
            [false, `Inherit from ${namespace}`, inherited ? `Currently: ${describePolicy(inherited)}.` : "This registry name has no rules, so nothing is cleaned up."],
            [true, "Custom rules", `Rules just for this repository replace the ones from ${namespace}.`],
          ].map(([v, title, hint]) => (
            <label
              key={String(v)}
              className="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-sm has-checked:border-ring/60 has-checked:bg-input/30"
            >
              <input
                type="radio"
                name={`${id}-mode`}
                checked={custom === v}
                onChange={() => {
                  setCustom(v as boolean)
                  setPreview(null)
                }}
                className="mt-1 size-4 shrink-0 accent-primary"
              />
              <span className="grid gap-0.5">
                <span className="font-medium">{title as string}</span>
                <span className="text-xs text-pretty text-muted-foreground">{hint as string}</span>
              </span>
            </label>
          ))}
        </div>
      )}
      {(!repo || custom) && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid content-start gap-1.5">
            <Label htmlFor={`${id}-keepLast`}>Keep only the newest tags</Label>
            <Input id={`${id}-keepLast`} type="number" min={1} max={1000} value={f.keepLast} onChange={set("keepLast")} placeholder="Off" />
            <p className="text-xs text-pretty text-muted-foreground">Keeps this many of the most recently pushed tags and deletes the older ones.</p>
          </div>
          <div className="grid content-start gap-1.5">
            <Label htmlFor={`${id}-notPulledDays`}>Delete tags not pulled for (days)</Label>
            <Input id={`${id}-notPulledDays`} type="number" min={1} value={f.notPulledDays} onChange={set("notPulledDays")} placeholder="Off" />
            <p className="text-xs text-pretty text-muted-foreground">Counts from the push when a tag was never pulled.</p>
          </div>
          <div className="grid content-start gap-1.5">
            <Label htmlFor={`${id}-keepPattern`}>Always keep tags matching</Label>
            <Input id={`${id}-keepPattern`} value={f.keepPattern} onChange={set("keepPattern")} className="font-mono" />
            <p className="text-xs text-pretty text-muted-foreground">Kept even if another rule would delete them. {PATTERN_HELP}</p>
          </div>
          <div className="grid content-start gap-1.5">
            <Label htmlFor={`${id}-deletePattern`}>Delete tags matching</Label>
            <Input id={`${id}-deletePattern`} value={f.deletePattern} onChange={set("deletePattern")} className="font-mono" />
            <p className="text-xs text-pretty text-muted-foreground">{PATTERN_HELP}</p>
          </div>
          <div className="grid content-start gap-1.5">
            <Label htmlFor={`${id}-untaggedDays`}>Delete untagged images after (days)</Label>
            <Input id={`${id}-untaggedDays`} type="number" min={1} value={f.untaggedDays} onChange={set("untaggedDays")} placeholder="Off" />
            <p className="text-xs text-pretty text-muted-foreground">Images no tag points to any more, once older than this.</p>
          </div>
        </div>
      )}
      <p className="text-xs text-pretty text-muted-foreground">
        Tags you always keep are spared by every other rule. Cleanup runs daily and moves things to Trash, where they wait 7 days
        before they are purged. Immutable tags are never touched.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton pending={pending} className={TOUCH}>
          Save cleanup rules
        </SubmitButton>
        <Button
          type="button"
          variant="outline"
          className={TOUCH}
          disabled={pending}
          onClick={() => {
            setError(undefined)
            start(async () => {
              const r = await previewCleanup(repo ? { repo } : { namespace }, effective)
              if (r.error) return setError(r.error)
              setPreview(r)
            })
          }}
        >
          Preview
        </Button>
        <RunNow scope={repo ?? namespace} isRepo={Boolean(repo)} disabled={dirty || !hasRules} />
        <span className="text-xs text-muted-foreground">{dirty ? "Save first. Run now uses the saved rules." : "Run now runs the saved rules."}</span>
      </div>
      <FormError>{error}</FormError>
      {preview && <PreviewList p={preview} scope={repo ? "repo" : "namespace"} />}
    </form>
  )
}

function RunNow({ scope, isRepo, disabled }: { scope: string; isRepo: boolean; disabled: boolean }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string>()
  const setNotice = useNotice()
  return (
    <span className="flex flex-col gap-1">
      <Confirm
        label="Run now"
        danger={false}
        size="default"
        disabled={disabled}
        question="Moves everything the saved rules select to Trash."
        yes="Run cleanup"
        pending={pending}
        onYes={() =>
          start(async () => {
            const r = await (isRepo ? runCleanup(scope) : runNamespaceCleanup(scope))
            if (r.error) return setError(r.error)
            setNotice({ text: "Cleanup ran. Anything it removed is in Trash." })
          })
        }
      />
      <FormError>{error}</FormError>
    </span>
  )
}

function PreviewList({ p, scope }: { p: Preview; scope: "repo" | "namespace" }) {
  const tags = p.tags ?? []
  const untagged = p.untagged ?? []
  const rows = [...tags.map((t) => ({ ...t, kind: "tag" })), ...untagged.map((t) => ({ ...t, kind: "untagged" }))]
  return (
    <div className="grid gap-2 rounded-lg border bg-input/10 p-3 text-sm" role="status">
      <p className="font-medium">
        {rows.length === 0
          ? "Nothing would be moved to Trash."
          : `${[
              tags.length && `${tags.length} ${tags.length === 1 ? "tag" : "tags"}`,
              untagged.length && `${untagged.length} untagged ${untagged.length === 1 ? "image" : "images"}`,
            ]
              .filter(Boolean)
              .join(" and ")} would move to Trash.`}
      </p>
      {scope === "namespace" && (
        <p className="text-xs text-muted-foreground">
          Covers {p.repos === 1 ? "1 repository" : `${p.repos} repositories`} without their own rules.
        </p>
      )}
      {rows.length > 0 && (
        <ul className="max-h-56 divide-y overflow-y-auto rounded-md border text-xs">
          {rows.slice(0, 100).map((r) => (
            <li key={`${r.kind}-${r.repo}-${r.name}`} className="flex flex-wrap items-center gap-x-2 px-3 py-1.5 font-mono">
              <span className="break-all">{scope === "namespace" ? `${r.repo}${r.kind === "tag" ? ":" : "@"}${r.name}` : r.name}</span>
              {r.kind === "untagged" && <Badge variant="outline">Untagged</Badge>}
            </li>
          ))}
          {rows.length > 100 && <li className="px-3 py-1.5 text-muted-foreground">and {rows.length - 100} more</li>}
        </ul>
      )}
    </div>
  )
}

// ---- Webhooks --------------------------------------------------------------

const EVENTS = [
  ["push", "Push"],
  ["delete", "Delete"],
  ["scan", "Scan finished"],
] as const

// `repo` is the part after the namespace; omit for namespace-wide hooks.
export function Hooks({ namespace, repo, initial }: { namespace: string; repo?: string; initial: HookRow[] }) {
  const id = useId()
  const [hooks, setHooks] = useState(initial)
  const [url, setUrl] = useState("")
  const [events, setEvents] = useState<string[]>(["push"])
  const [secret, setSecret] = useState<string | null>(null)
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()
  const setNotice = useNotice()
  const reload = async () => setHooks(await repoHooks(repo ? `${namespace}/${repo}` : namespace))
  return (
    <div className="grid gap-3">
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          setError(undefined)
          start(async () => {
            const r = await addHook(namespace, repo ?? "", url, events)
            if (r.error) return setError(r.error)
            setUrl("")
            setSecret(r.secret ?? null)
            await reload()
          })
        }}
      >
        <div className="flex flex-wrap gap-2">
          <Input
            aria-label="Webhook URL"
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://ci.example/registry-hook"
            className="min-w-0 flex-1 basis-64"
          />
          <Button type="submit" variant="outline" className={TOUCH} disabled={pending}>
            <PlusIcon />
            Add webhook
          </Button>
        </div>
        <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <legend className="sr-only">Events</legend>
          <span className="text-xs text-muted-foreground">Send on</span>
          {EVENTS.map(([v, label]) => (
            <label key={v} className="flex items-center gap-1.5 text-sm pointer-coarse:min-h-11">
              <input
                type="checkbox"
                className="size-4 shrink-0 accent-primary"
                checked={events.includes(v)}
                onChange={(e) => setEvents(e.target.checked ? [...events, v] : events.filter((x) => x !== v))}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <FormError>{error}</FormError>
      </form>
      {hooks.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          No webhooks{repo ? " for this repository" : ""}.
        </p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border">
          {hooks.map((h) => (
            <HookItem key={h.id} h={h} onChange={reload} notice={setNotice} />
          ))}
        </ul>
      )}
      <p id={`${id}-note`} className="text-xs text-pretty text-muted-foreground">
        Each delivery is a JSON POST signed with HMAC-SHA256 in the <code className="font-mono">X-Nimbus-Signature</code> header.
        The signing secret is shown once, right after you add the webhook.
      </p>
      <Dialog.Root open={secret !== null} onOpenChange={(o) => !o && setSecret(null)}>
        <Dialog.Portal>
          <Dialog.Backdrop className={DIALOG_BACKDROP} />
          <Dialog.Popup className={DIALOG_POPUP}>
            <div className="grid gap-1.5">
              <Dialog.Title className="text-base font-semibold">Copy the signing secret</Dialog.Title>
              <Dialog.Description className="text-sm text-pretty text-muted-foreground">
                You won&apos;t see it again. Use it to check the signature of each delivery.
              </Dialog.Description>
            </div>
            <code data-testid="hook-secret" className="block rounded-md border bg-input/20 px-3 py-2 font-mono text-sm break-all select-all">
              {secret}
            </code>
            <div className="flex justify-end gap-2">
              {secret && <CopyButton value={secret} />}
              <Dialog.Close render={<Button />}>Done</Dialog.Close>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}

function HookItem({ h, onChange, notice }: { h: HookRow; onChange: () => Promise<void>; notice: ReturnType<typeof useNotice> }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string>()
  const [log, setLog] = useState<DeliveryRow[] | null>(null)
  const showLog = async () => setLog(await hookLog(h.id))
  return (
    <li className="flex flex-col gap-2 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="grid min-w-0 flex-1 basis-56 gap-1">
          <span className={cn("truncate font-mono text-sm", !h.enabled && "opacity-60")} title={h.url}>
            {h.url}
          </span>
          <span className="flex flex-wrap gap-1.5">
            {h.events.map((e) => (
              <Badge key={e} variant="outline">
                {e}
              </Badge>
            ))}
            {h.repo && <Badge variant="secondary">{h.repo}</Badge>}
          </span>
        </div>
        <label className="flex items-center gap-2 text-sm pointer-coarse:min-h-11">
          <Switch
            aria-label={`Send to ${h.url}`}
            checked={h.enabled}
            disabled={pending}
            onChange={(e) =>
              start(async () => {
                const r = await toggleHook(h.id, e.target.checked)
                if (r.error) return setError(r.error)
                await onChange()
              })
            }
          />
          On
        </label>
        <Button
          variant="outline"
          size="sm"
          className={TOUCH}
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(undefined)
              const r = await sendTestHook(h.id)
              if (r.error) return setError(r.error)
              notice({ text: "Test event sent." })
              // The delivery runs in the worker; give it a moment.
              await new Promise((ok) => setTimeout(ok, 1500))
              await showLog()
            })
          }
        >
          <PaperPlaneTiltIcon />
          Test
        </Button>
        <Button variant="ghost" size="sm" className={TOUCH} onClick={() => (log ? setLog(null) : showLog())}>
          {log ? "Hide log" : "Log"}
        </Button>
        <Confirm
          label="Remove"
          question="Stops sending and drops its log."
          yes="Remove"
          pending={pending}
          onYes={() =>
            start(async () => {
              const r = await removeHook(h.id)
              if (r.error) return setError(r.error)
              notice({ text: "Webhook removed." })
              await onChange()
            })
          }
        />
      </div>
      {log && (
        <ul className="divide-y rounded-md border text-xs" aria-label="Recent deliveries">
          {log.length === 0 && <li className="px-3 py-2 text-muted-foreground">Nothing sent yet.</li>}
          {log.map((d) => (
            <li key={d.id} suppressHydrationWarning className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-1.5">
              <span className={cn("w-20 shrink-0 font-medium", d.delivered ? "text-brand" : "text-destructive")}>
                {d.delivered ? "Delivered" : d.attempts ? "Failed" : "Waiting"}
              </span>
              <span className="text-muted-foreground">{WHEN.format(new Date(d.at))}</span>
              <span className="text-muted-foreground">
                {d.event}
                {d.status ? ` · ${d.status}` : ""}
                {d.attempts > 1 ? ` · ${d.attempts} tries` : ""}
              </span>
              {d.error && <span className="basis-full text-destructive">{d.error}</span>}
            </li>
          ))}
        </ul>
      )}
      <FormError>{error}</FormError>
    </li>
  )
}

// ---- Namespace settings ------------------------------------------------------

// One row per namespace the member owns, opening cleanup rules and webhooks.
export function NamespacesSection({ owned, repos }: { owned: OwnedNamespace[]; repos: RepoRow[] }) {
  const [open, setOpen] = useState<OwnedNamespace | null>(null)
  const [log, setLog] = useState<{ ns: OwnedNamespace; page: ActivityPage | null } | null>(null)
  const showLog = async (n: OwnedNamespace) => {
    setLog({ ns: n, page: null })
    const page = await activityPage({ namespaceId: n.id }, {})
    setLog((cur) => (cur?.ns.id === n.id ? { ns: n, page } : cur))
  }
  const [data, setData] = useState<{ policy: Policy | null; hooks: HookRow[] } | null>(null)
  const pick = async (n: OwnedNamespace) => {
    setData(null)
    setOpen(n)
    setData(await namespaceSettings(n.name))
  }
  return (
    <section className={SECTION} aria-labelledby="ns-heading">
      <Heading
        id="ns-heading"
        title="Cleanup, webhooks and activity"
        hint="Rules that tidy old tags for every repository in a registry name, webhooks that tell your tools when images change, and who did what there."
      />
      <ul className={LIST}>
        {owned.map((n) => (
          <li key={n.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
            <div className="grid min-w-0 flex-1 basis-56 gap-0.5">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                <span className="font-mono break-all">{n.name}</span>
                <Badge variant="outline">{n.kind === "org" ? "Org" : "You"}</Badge>
              </p>
              <p className="text-xs text-muted-foreground">
                Cleanup: {describePolicy(n.policy)} · {n.hooks === 1 ? "1 webhook" : `${n.hooks} webhooks`}
              </p>
            </div>
            <Button variant="outline" size="sm" className={TOUCH} aria-label={`Activity for ${n.name}`} onClick={() => showLog(n)}>
              <ClockCounterClockwiseIcon />
              View activity
            </Button>
            <Button variant="outline" size="sm" className={TOUCH} onClick={() => pick(n)}>
              <BroomIcon />
              Settings
            </Button>
          </li>
        ))}
      </ul>
      <Dialog.Root open={Boolean(log)} onOpenChange={(o) => !o && setLog(null)}>
        <Dialog.Portal>
          <Dialog.Backdrop className={DIALOG_BACKDROP} />
          <Dialog.Popup className={cn(DIALOG_POPUP, "max-h-[calc(100svh-2rem)] max-w-2xl overflow-y-auto")}>
            {log && (
              <>
                <div className="grid gap-1.5">
                  <Dialog.Title className="text-base font-semibold break-all">
                    <span className="font-mono">{log.ns.name}</span> · Activity
                  </Dialog.Title>
                  <Dialog.Description className="text-sm text-pretty text-muted-foreground">
                    Everything in this registry name, for the last 90 days.
                  </Dialog.Description>
                </div>
                {log.page ? (
                  <ActivityList
                    key={log.ns.id}
                    scope={{ namespaceId: log.ns.id }}
                    initial={log.page}
                    repos={repos.filter((r) => r.namespace === log.ns.name).map((r) => ({ id: r.id, name: r.name }))}
                  />
                ) : (
                  <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
                )}
                <div className="flex justify-end">
                  <Dialog.Close render={<Button variant="outline" />}>Close</Dialog.Close>
                </div>
              </>
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={Boolean(open)} onOpenChange={(o) => !o && setOpen(null)}>
        <Dialog.Portal>
          <Dialog.Backdrop className={DIALOG_BACKDROP} />
          <Dialog.Popup className={cn(DIALOG_POPUP, "max-h-[calc(100svh-2rem)] max-w-2xl overflow-y-auto")}>
            {open && (
              <>
                <div className="grid gap-1.5">
                  <Dialog.Title className="text-base font-semibold break-all">
                    <span className="font-mono">{open.name}</span> · Cleanup and webhooks
                  </Dialog.Title>
                  <Dialog.Description className="text-sm text-pretty text-muted-foreground">
                    Applies to every repository here that doesn&apos;t set its own rules.
                  </Dialog.Description>
                </div>
                {data ? (
                  <>
                    <div className="grid gap-2">
                      <h3 className="text-sm font-medium">Cleanup rules</h3>
                      <PolicyEditor key={open.id} namespace={open.name} initial={data.policy} />
                    </div>
                    <div className="grid gap-2 border-t pt-4">
                      <h3 className="text-sm font-medium">Webhooks</h3>
                      <Hooks key={open.id} namespace={open.name} initial={data.hooks} />
                    </div>
                  </>
                ) : (
                  <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
                )}
                <div className="flex justify-end">
                  <Dialog.Close render={<Button variant="outline" />}>Close</Dialog.Close>
                </div>
              </>
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  )
}
