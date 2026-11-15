"use client"

import { Dialog } from "@base-ui/react/dialog"
import {
  CheckCircleIcon,
  ClockIcon,
  HammerIcon,
  HourglassMediumIcon,
  MinusCircleIcon,
  PlayIcon,
  SpinnerGapIcon,
  StopCircleIcon,
  UploadSimpleIcon,
  XCircleIcon,
} from "@phosphor-icons/react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useId, useRef, useState, useTransition } from "react"

import { buildPage, startBuild } from "@/app/(app)/registry/build-actions"
import { RuleSection, type PresetView, type RuleView } from "@/components/registry-build-rules"
import { ConnectSources, SourceRow, type SourceView } from "@/components/registry-build-sources"
import { DIALOG_BACKDROP, DIALOG_POPUP } from "@/components/overlay-styles"
import { CopyButton } from "@/components/copy-button"
import { Code, Empty, Heading, LIST, SECTION, Segmented, TOUCH } from "@/components/registry-ui"
import { SubmitButton } from "@/components/submit-button"
import { FormError } from "@/components/two-factor"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { TRIGGER_LABEL, ago, buildMs, duration, isActive, type BuildItem } from "@/lib/registry/build-view"

// ---- status ------------------------------------------------------------------------------------

const STATUS = {
  queued: { icon: ClockIcon, tone: "text-muted-foreground", label: "Queued" },
  waiting: { icon: HourglassMediumIcon, tone: "text-warning", label: "Waiting" },
  running: { icon: SpinnerGapIcon, tone: "text-brand", label: "Running" },
  success: { icon: CheckCircleIcon, tone: "text-brand", label: "Succeeded" },
  failed: { icon: XCircleIcon, tone: "text-destructive", label: "Failed" },
  cancelled: { icon: MinusCircleIcon, tone: "text-muted-foreground", label: "Cancelled" },
  stopped: { icon: StopCircleIcon, tone: "text-warning", label: "Stopped" },
} as const

// Ticks once a second while `on`.
export function useNow(on: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [on])
  return now
}

export function StatusChip({ status, startedAt, reason }: Pick<BuildItem, "status" | "startedAt"> & { reason?: string | null }) {
  const s = STATUS[status]
  const now = useNow(status === "running")
  const Icon = s.icon
  const ms = status === "running" ? buildMs({ startedAt, finishedAt: null }, now) : null
  return (
    <Badge variant="outline" className="py-1 pointer-coarse:py-1.5">
      <Icon aria-hidden weight={status === "running" ? "bold" : "fill"} className={cn(s.tone, status === "running" && "animate-spin motion-reduce:animate-none")} />
      {s.label}
      {ms !== null && <span className="text-muted-foreground tabular-nums">{duration(ms)}</span>}
      {reason && status === "waiting" && <span className="sr-only">: {reason}</span>}
    </Badge>
  )
}

export const detailHref = (name: string, id: string) => `/registry/${name}?tab=builds&build=${id}`

export function BuildsOff({ children }: { children: React.ReactNode }) {
  return (
    <Empty icon={HammerIcon} title="Builds are off">
      {children}
    </Empty>
  )
}

// One line on the Overview: how the newest build went.
export function LatestBuild({ name, b }: { name: string; b: BuildItem }) {
  return (
    <div className="relative flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border bg-card px-4 py-3 hover:bg-accent/30 focus-within:bg-accent/30">
      <span className="text-sm font-medium">Latest build</span>
      <StatusChip status={b.status} startedAt={b.startedAt} reason={b.reason} />
      <Link
        href={detailHref(name, b.id)}
        className="min-w-0 rounded-sm font-mono text-sm break-all outline-none after:absolute after:inset-0 focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {b.ref ?? TRIGGER_LABEL[b.trigger]}
      </Link>
      <span suppressHydrationWarning className="text-xs text-muted-foreground">
        {ago(b.createdAt)}
      </span>
    </div>
  )
}

// Settings: how to check that an image really came from this server's builds.
export function SigningSection({ host, name, publicKey }: { host: string; name: string; publicKey: string | null }) {
  const command = `cosign verify --key nimbus.pub ${host}/${name}:latest`
  const download = () => {
    const url = URL.createObjectURL(new Blob([publicKey ?? ""], { type: "text/plain" }))
    const a = document.createElement("a")
    a.href = url
    a.download = "nimbus.pub"
    a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <section className={SECTION} aria-labelledby="signing-heading">
      <Heading id="signing-heading" title="Image signing" hint="Images built here are signed with this server's key, so anyone can check where an image came from." />
      <div className="grid gap-3 rounded-xl border bg-card p-4">
        {publicKey ? (
          <>
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">Check an image</span>
              <div className="relative">
                <Code copy>{command}</Code>
                <div className="absolute top-2 right-2">
                  <CopyButton value={command} label="Copy the verify command" className={TOUCH} />
                </div>
              </div>
            </div>
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">Public key (nimbus.pub)</span>
              <div className="relative">
                <Code copy>{publicKey.trim()}</Code>
                <div className="absolute top-2 right-2 flex gap-1.5">
                  <CopyButton value={publicKey} label="Copy the public key" className={TOUCH} />
                  <Button type="button" variant="outline" size="sm" className={TOUCH} onClick={download}>
                    Save
                  </Button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-pretty text-muted-foreground">The signing key is made when the first build finishes. Its public half shows up here.</p>
        )}
      </div>
    </section>
  )
}

// ---- the tab ----------------------------------------------------------------------------------

export type BuildsTabProps = {
  repo: { id: string; fullName: string; canAdmin: boolean; archived: boolean }
  source: SourceView | null
  rules: RuleView[]
  presets: PresetView[]
  platforms: string[]
  initial: { rows: BuildItem[]; more: boolean }
  scanOn: boolean
  arch: string
}

export function BuildsTab({ repo, source, rules, presets, platforms, initial, scanOn, arch }: BuildsTabProps) {
  if (!source)
    return repo.canAdmin ? (
      <ConnectSources repoId={repo.id} fullName={repo.fullName} />
    ) : (
      <Empty icon={HammerIcon} title="No build source yet">
        <p>A repository admin can connect GitHub, a git URL or uploads here. You can still build once it is set up.</p>
      </Empty>
    )
  const suggestions = rules.filter((r) => r.enabled && !/^re:|[*?,]/.test(r.pattern)).map((r) => ({ type: r.sourceType, name: r.pattern }))
  return (
    <div className="flex flex-col gap-8">
      <SourceRow repoId={repo.id} source={source} canAdmin={repo.canAdmin} />
      {source.kind !== "upload" && (
        <RuleSection repo={repo} rules={rules} presets={presets} platforms={platforms} scanOn={scanOn} arch={arch} />
      )}
      <section className={SECTION} aria-labelledby="history-heading">
        <Heading id="history-heading" title="Build history" hint="The last 50 builds. Open one to read its log.">
          <div className="flex flex-wrap gap-2">
            {source.kind !== "upload" && <BuildNow repoId={repo.id} suggestions={suggestions} disabled={repo.archived} />}
            <UploadBuild repoId={repo.id} primary={source.kind === "upload"} disabled={repo.archived} />
          </div>
        </Heading>
        <History name={repo.fullName} initial={initial} />
      </section>
    </div>
  )
}

// ---- history ------------------------------------------------------------------------------------

function History({ name, initial }: { name: string; initial: { rows: BuildItem[]; more: boolean } }) {
  const [rows, setRows] = useState(initial.rows)
  const [more, setMore] = useState(initial.more)
  const [pending, start] = useTransition()
  const active = rows.some((r) => isActive(r.status))
  // While anything is queued or running the first page refreshes every 5 seconds.
  useEffect(() => {
    if (!active) return
    const t = setInterval(async () => {
      const fresh = await buildPage(name).catch(() => null)
      if (!fresh?.rows.length) return
      setRows((old) => {
        const oldest = fresh.rows[fresh.rows.length - 1].createdAt
        return [...fresh.rows, ...old.filter((r) => r.createdAt < oldest)]
      })
    }, 5000)
    return () => clearInterval(t)
  }, [active, name])
  if (rows.length === 0)
    return (
      <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
        No builds yet. They show up here when a push matches a rule, or when you press Build now.
      </p>
    )
  return (
    <div className="grid gap-3">
      <ul className={LIST}>
        {rows.map((b) => (
          <BuildRowItem key={b.id} name={name} b={b} />
        ))}
      </ul>
      {more && (
        <Button
          variant="outline"
          className={cn("w-fit", TOUCH)}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await buildPage(name, { before: rows[rows.length - 1].createdAt })
              setRows((old) => [...old, ...r.rows])
              setMore(r.more)
            })
          }
        >
          {pending ? "Loading…" : "Show older builds"}
        </Button>
      )}
    </div>
  )
}

function BuildRowItem({ name, b }: { name: string; b: BuildItem }) {
  const now = useNow(isActive(b.status))
  const ms = buildMs(b, now)
  const what = b.ref ?? (b.trigger === "cli" || b.trigger === "upload" ? "Uploaded folder" : "Build")
  return (
    <li className="relative flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 hover:bg-accent/30 focus-within:bg-accent/30">
      <div className="grid min-w-0 flex-1 basis-56 gap-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <StatusChip status={b.status} startedAt={b.startedAt} reason={b.reason} />
          <Link
            href={detailHref(name, b.id)}
            className="min-w-0 rounded-sm font-mono text-sm font-medium break-all outline-none after:absolute after:inset-0 focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {what}
          </Link>
          {b.commit && <code className="font-mono text-xs text-muted-foreground">{b.commit.slice(0, 7)}</code>}
        </div>
        <p className="text-xs text-pretty text-muted-foreground">
          {TRIGGER_LABEL[b.trigger]}
          {b.who ? ` · ${b.who}` : ""}
          {b.reason && b.status !== "success" ? ` · ${b.reason}` : ""}
        </p>
      </div>
      {b.tags.length > 0 && (
        <div className="relative z-10 flex min-w-0 flex-wrap gap-1.5 sm:max-w-56">
          {b.tags.slice(0, 4).map((t) => (
            <Link
              key={t}
              href={`/registry/${name}?tab=tags&tag=${encodeURIComponent(t)}`}
              className="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:flex pointer-coarse:min-h-11 pointer-coarse:items-center"
            >
              <Badge variant="outline" className="font-mono hover:bg-accent">
                {t}
              </Badge>
            </Link>
          ))}
          {b.tags.length > 4 && <span className="self-center text-xs text-muted-foreground">+{b.tags.length - 4}</span>}
        </div>
      )}
      <div className="grid w-full justify-items-start gap-0.5 text-xs text-muted-foreground tabular-nums sm:w-auto sm:min-w-24 sm:justify-items-end">
        <span>{ms === null ? "Not started" : duration(ms)}</span>
        <span suppressHydrationWarning>{ago(b.createdAt)}</span>
      </div>
    </li>
  )
}

// ---- Build now --------------------------------------------------------------------------------------

function BuildNow({ repoId, suggestions, disabled }: { repoId: string; suggestions: { type: "branch" | "tag"; name: string }[]; disabled: boolean }) {
  const router = useRouter()
  const id = useId()
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<"branch" | "tag">(suggestions[0]?.type ?? "branch")
  const [name, setName] = useState(suggestions[0]?.name ?? "")
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()
  const go = () =>
    start(async () => {
      setError(undefined)
      const r = await startBuild(repoId, { ref: { type, name: name.trim() } })
      if (r.error || !r.id) return setError(r.error ?? "Couldn't start the build.")
      setOpen(false)
      router.push(`?tab=builds&build=${r.id}`)
    })
  return (
    <>
      <Button className={TOUCH} disabled={disabled} onClick={() => setOpen(true)}>
        <PlayIcon weight="fill" />
        Build now
      </Button>
      <Dialog.Root open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <Dialog.Portal>
          <Dialog.Backdrop className={DIALOG_BACKDROP} />
          <Dialog.Popup className={DIALOG_POPUP}>
            <div className="grid gap-1.5">
              <Dialog.Title className="text-base font-semibold">Build now</Dialog.Title>
              <Dialog.Description className="text-sm text-pretty text-muted-foreground">
                Builds the newest commit of a branch or tag, with the first rule that matches it.
              </Dialog.Description>
            </div>
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                go()
              }}
            >
              <Segmented
                label="Build a"
                value={type}
                options={[
                  ["branch", "Branch"],
                  ["tag", "Tag"],
                ]}
                onChange={setType}
              />
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-ref`}>{type === "branch" ? "Branch name" : "Tag name"}</Label>
                <Input
                  id={`${id}-ref`}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={type === "branch" ? "main" : "v1.2.3"}
                  className="font-mono pointer-coarse:h-11"
                  autoComplete="off"
                  spellCheck={false}
                  autoFocus
                />
                {suggestions.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">From your rules:</span>
                    {suggestions.map((s) => (
                      <button
                        key={`${s.type}:${s.name}`}
                        type="button"
                        onClick={() => (setType(s.type), setName(s.name))}
                        className="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:min-h-11"
                      >
                        <Badge variant="outline" className="font-mono hover:bg-accent">
                          {s.name}
                        </Badge>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <FormError>{error}</FormError>
              <div className="flex justify-end gap-2">
                <Dialog.Close disabled={pending} render={<Button type="button" variant="outline" className={TOUCH} />}>
                  Cancel
                </Dialog.Close>
                <SubmitButton pending={pending} disabled={!name.trim()} className={TOUCH}>
                  Start build
                </SubmitButton>
              </div>
            </form>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}

// ---- Upload a folder ------------------------------------------------------------------------------------

const ACCEPT = ".zip,.tar,.tar.gz,.tgz"

export function UploadBuild({ repoId, primary, disabled, inline }: { repoId: string; primary?: boolean; disabled?: boolean; inline?: boolean }) {
  const router = useRouter()
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [tags, setTags] = useState("latest")
  const [dockerfile, setDockerfile] = useState("")
  const [over, setOver] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string>()
  const xhr = useRef<XMLHttpRequest | null>(null)

  const pick = (f: File | undefined | null) => {
    if (!f) return
    if (!/\.(zip|tar|tar\.gz|tgz)$/i.test(f.name)) return setError("Use a .zip, .tar or .tar.gz file.")
    setError(undefined)
    setFile(f)
  }
  const send = () => {
    if (!file) return
    setError(undefined)
    setProgress(0)
    const q = new URLSearchParams({ repo: repoId, tags })
    if (dockerfile.trim()) q.set("dockerfile", dockerfile.trim())
    const x = new XMLHttpRequest()
    xhr.current = x
    x.open("POST", `/api/registry/builds/upload?${q}`)
    x.upload.onprogress = (e) => e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100))
    x.onerror = () => (setProgress(null), setError("The upload didn't finish. Check your connection and try again."))
    x.onabort = () => setProgress(null)
    x.onload = () => {
      setProgress(null)
      let r: { id?: string; error?: string } = {}
      try {
        r = JSON.parse(x.responseText)
      } catch {}
      if (!r.id) return setError(r.error ?? "The upload didn't work.")
      setOpen(false)
      router.push(`?tab=builds&build=${r.id}`)
    }
    x.send(file)
  }
  const busy = progress !== null
  return (
    <>
      <Button variant={primary ? "default" : "outline"} className={cn(TOUCH, inline && "w-fit")} disabled={disabled} onClick={() => setOpen(true)}>
        <UploadSimpleIcon />
        Upload a folder
      </Button>
      <Dialog.Root
        open={open}
        onOpenChange={(o) => {
          if (!o) xhr.current?.abort()
          setOpen(o)
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className={DIALOG_BACKDROP} />
          <Dialog.Popup className={DIALOG_POPUP}>
            <div className="grid gap-1.5">
              <Dialog.Title className="text-base font-semibold">Build from a folder</Dialog.Title>
              <Dialog.Description className="text-sm text-pretty text-muted-foreground">
                Upload your project as a .zip or .tar, with its Dockerfile inside. Up to 2 GB.
              </Dialog.Description>
            </div>
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                send()
              }}
            >
              <label
                htmlFor={`${id}-file`}
                onDragOver={(e) => (e.preventDefault(), setOver(true))}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setOver(false)
                  pick(e.dataTransfer.files[0])
                }}
                className={cn(
                  "flex min-h-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed px-4 py-6 text-center text-sm has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50",
                  over && "border-ring bg-input/30"
                )}
              >
                <UploadSimpleIcon aria-hidden className="size-6 text-muted-foreground" />
                {file ? (
                  <span className="font-medium break-all">{file.name}</span>
                ) : (
                  <span>
                    Drop a file here, or <span className="underline underline-offset-4">choose one</span>
                  </span>
                )}
                <input id={`${id}-file`} ref={input} type="file" accept={ACCEPT} className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
              </label>
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-tags`}>Image tags</Label>
                <Input id={`${id}-tags`} value={tags} onChange={(e) => setTags(e.target.value)} className="font-mono pointer-coarse:h-11" spellCheck={false} autoComplete="off" />
                <p className="text-xs text-muted-foreground">Separate several with commas.</p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-df`}>Dockerfile path (optional)</Label>
                <Input id={`${id}-df`} value={dockerfile} onChange={(e) => setDockerfile(e.target.value)} placeholder="Dockerfile" className="font-mono pointer-coarse:h-11" spellCheck={false} autoComplete="off" />
              </div>
              {busy && (
                <div role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Uploading" className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-primary transition-[width]" style={{ width: `${progress}%` }} />
                </div>
              )}
              <FormError>{error}</FormError>
              <div className="flex justify-end gap-2">
                <Dialog.Close render={<Button type="button" variant="outline" className={TOUCH} />}>Cancel</Dialog.Close>
                <SubmitButton pending={busy} disabled={!file || !tags.trim()} className={TOUCH}>
                  Upload and build
                </SubmitButton>
              </div>
            </form>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}

