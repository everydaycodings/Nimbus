"use client"

import { Dialog } from "@base-ui/react/dialog"
import { BroomIcon, PencilSimpleIcon, PlusIcon } from "@phosphor-icons/react"
import Link from "next/link"
import { useId, useState, useTransition } from "react"

import { adminCancelBuild, cleanBuildCache, deleteRegistryMirror, runRegistryGc, saveRegistryMirror } from "@/app/(app)/admin/actions"
import { DIALOG_BACKDROP, DIALOG_POPUP } from "@/components/overlay-styles"
import { ConfirmAction } from "@/components/admin/registry-actions"
import { StatusChip, detailHref } from "@/components/registry-builds"
import { Confirm } from "@/components/registry-ui"
import { SubmitButton } from "@/components/submit-button"
import { useNotice } from "@/components/toaster"
import { FormError } from "@/components/two-factor"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatBytes } from "@/lib/file-rules"
import { ago, type BuildItem } from "@/lib/registry/build-view"
import type { Upstream } from "@/lib/registry/manage"
import { cn } from "@/lib/utils"

const PRESETS = [
  { label: "Docker Hub", name: "dockerhub", url: "https://registry-1.docker.io" },
  { label: "GitHub", name: "ghcr", url: "https://ghcr.io" },
  { label: "Quay", name: "quay", url: "https://quay.io" },
]

type Draft = { id?: string; name: string; url: string; username: string; password: string; clearPassword: boolean; ttlDays: string; enabled: boolean }
const blank: Draft = { name: "", url: "", username: "", password: "", clearPassword: false, ttlDays: "30", enabled: true }

// Which field a saveUpstream error is about, so focus and aria can point at it.
const errorField = (e: string) =>
  /address|https|credentials/i.test(e) ? "url" : /days/i.test(e) ? "ttl" : /name|mirror/i.test(e) ? "name" : undefined

export function MirrorsAdmin({ upstreams, host }: { upstreams: Upstream[]; host: string }) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saved, setSaved] = useState<Upstream | null>(null)
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()
  const setNotice = useNotice()
  const id = useId()
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => d && { ...d, [k]: v })
  const open = (u: Upstream | null, preset?: (typeof PRESETS)[number]) => {
    setError(undefined)
    setSaved(u)
    setDraft(
      u
        ? { id: u.id, name: u.name, url: u.url, username: u.username ?? "", password: "", clearPassword: false, ttlDays: String(u.ttlDays), enabled: u.enabled }
        : { ...blank, ...(preset ? { name: preset.name, url: preset.url } : {}) }
    )
  }
  return (
    <section id="registry-mirrors" className="flex scroll-mt-24 flex-col gap-3">
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        <div className="mr-auto grid gap-1">
          <h2 className="text-base font-semibold">
            Mirrors <span className="font-normal text-muted-foreground tabular-nums">{upstreams.length}</span>
          </h2>
          <p className="max-w-prose text-sm text-pretty text-muted-foreground">
            Pull-through caches of other registries. Members pull{" "}
            <span className="font-mono">{host}/mirror/&lt;name&gt;/&lt;repo&gt;</span>; Nimbus fetches it once, keeps a copy
            and serves it after that.
          </p>
        </div>
        <Button onClick={() => open(null)}>
          <PlusIcon />
          Add mirror
        </Button>
      </div>
      {upstreams.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-input px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">No mirrors yet. Start from a common one:</p>
          <div className="flex flex-wrap justify-center gap-2">
            {PRESETS.map((p) => (
              <Button key={p.name} variant="outline" size="sm" className="pointer-coarse:h-11 pointer-coarse:px-4" onClick={() => open(null, p)}>
                {p.label}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border bg-card">
          <ul className="flex flex-col divide-y">
            {upstreams.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <span className="font-mono">{u.name}</span>
                    {!u.enabled && <Badge variant="secondary">Off</Badge>}
                    {u.username && <Badge variant="outline">{u.hasPassword ? "Signed in" : "User only"}</Badge>}
                  </p>
                  <p className="truncate text-sm text-muted-foreground">
                    {u.url} · kept {u.ttlDays === 1 ? "1 day" : `${u.ttlDays} days`} after the last pull
                  </p>
                </div>
                <Button variant="outline" size="sm" className="pointer-coarse:h-11 pointer-coarse:px-4" aria-label={`Edit ${u.name}`} onClick={() => open(u)}>
                  <PencilSimpleIcon />
                  Edit
                </Button>
                <ConfirmAction
                  label="Delete"
                  aria={`Delete ${u.name}`}
                  question={`Delete mirror ${u.name}? Cached copies expire on their own.`}
                  yes="Delete mirror"
                  done={`Deleted the ${u.name} mirror.`}
                  run={() => deleteRegistryMirror(u.id)}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      <Dialog.Root open={Boolean(draft)} onOpenChange={(o) => !o && !pending && setDraft(null)}>
        <Dialog.Portal>
          <Dialog.Backdrop className={DIALOG_BACKDROP} />
          <Dialog.Popup className={cn(DIALOG_POPUP, "max-h-[calc(100svh-2rem)] max-w-lg overflow-y-auto")}>
            {draft && (
              <>
                <div className="grid gap-1.5">
                  <Dialog.Title className="text-base font-semibold">{draft.id ? `Edit ${saved?.name}` : "Add mirror"}</Dialog.Title>
                  <Dialog.Description className="text-sm text-pretty text-muted-foreground">
                    Add a username and password only for registries that need them, like private ones or to lift Docker Hub&apos;s
                    pull limits. They are stored encrypted and never shown again.
                  </Dialog.Description>
                </div>
                <form
                  className="flex flex-col gap-4"
                  onSubmit={(e) => {
                    e.preventDefault()
                    setError(undefined)
                    start(async () => {
                      const r = await saveRegistryMirror({ ...draft, ttlDays: Number(draft.ttlDays) })
                      if (r.error) {
                        setError(r.error)
                        document.getElementById(`${id}-${errorField(r.error) ?? "err"}`)?.focus()
                        return
                      }
                      setNotice({ text: draft.id ? `Saved ${draft.name}.` : `Added the ${draft.name} mirror.` })
                      setDraft(null)
                    })
                  }}
                >
                  {!draft.id && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground">Presets</span>
                      {PRESETS.map((p) => (
                        <Button
                          key={p.name}
                          type="button"
                          variant="outline"
                          size="sm"
                          className="pointer-coarse:h-11 pointer-coarse:px-4"
                          onClick={() => setDraft((d) => d && { ...d, name: p.name, url: p.url })}
                        >
                          {p.label}
                        </Button>
                      ))}
                    </div>
                  )}
                  <div className="grid gap-2">
                    <Label htmlFor={`${id}-name`}>Name</Label>
                    <Input
                      id={`${id}-name`}
                      value={draft.name}
                      onChange={(e) => set("name", e.target.value.toLowerCase())}
                      maxLength={39}
                      aria-invalid={errorField(error ?? "") === "name" || undefined} aria-describedby={errorField(error ?? "") === "name" ? `${id}-err` : undefined}
                      autoComplete="off"
                      placeholder="dockerhub"
                      className="font-mono"
                    />
                    <p className="text-xs text-muted-foreground">
                      The path members use: <span className="font-mono">mirror/{draft.name || "name"}/…</span>
                    </p>
                    {saved && draft.name !== saved.name && (
                      <p className="text-xs text-pretty text-muted-foreground">
                        Members pull from the new path; images cached under the old name are dropped.
                      </p>
                    )}
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor={`${id}-url`}>Address</Label>
                    <Input
                      id={`${id}-url`}
                      type="url"
                      value={draft.url}
                      onChange={(e) => set("url", e.target.value)}
                      autoComplete="off"
                      placeholder="https://registry-1.docker.io"
                      aria-invalid={errorField(error ?? "") === "url" || undefined} aria-describedby={errorField(error ?? "") === "url" ? `${id}-err` : undefined}
                      className="font-mono"
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor={`${id}-user`}>Username (optional)</Label>
                      <Input id={`${id}-user`} value={draft.username} onChange={(e) => set("username", e.target.value)} autoComplete="off" />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor={`${id}-pass`}>Password or token</Label>
                      <Input
                        id={`${id}-pass`}
                        type="password"
                        value={draft.password}
                        onChange={(e) => set("password", e.target.value)}
                        autoComplete="new-password"
                        placeholder={saved?.hasPassword && !draft.clearPassword ? "Saved. Type to replace" : ""}
                      />
                    </div>
                  </div>
                  {saved?.hasPassword && !draft.username.trim() && !draft.clearPassword && (
                    <p className="text-xs text-pretty text-muted-foreground">
                      With no username, the saved password is removed when you save.
                    </p>
                  )}
                  {saved?.hasPassword && (
                    <label className="flex min-h-5 items-center gap-2 text-sm pointer-coarse:min-h-11">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary pointer-coarse:size-6"
                        checked={draft.clearPassword}
                        onChange={(e) => set("clearPassword", e.target.checked)}
                      />
                      Remove the saved password
                    </label>
                  )}
                  <div className="grid gap-2">
                    <Label htmlFor={`${id}-ttl`}>Keep cached images (days after the last pull)</Label>
                    <Input
                      id={`${id}-ttl`}
                      type="number"
                      min={1}
                      max={3650}
                      aria-invalid={errorField(error ?? "") === "ttl" || undefined} aria-describedby={errorField(error ?? "") === "ttl" ? `${id}-err` : undefined}
                      value={draft.ttlDays}
                      onChange={(e) => set("ttlDays", e.target.value)}
                      className="max-w-32"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm pointer-coarse:min-h-11">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary pointer-coarse:size-6"
                      checked={draft.enabled}
                      onChange={(e) => set("enabled", e.target.checked)}
                    />
                    Enabled
                  </label>
                  <p id={`${id}-err`} tabIndex={-1} role="alert" className="text-sm text-destructive outline-none empty:hidden">
                    {error}
                  </p>
                  <div className="flex justify-end gap-2">
                    <Dialog.Close disabled={pending} render={<Button type="button" variant="outline" className="pointer-coarse:h-11 pointer-coarse:px-4" />}>
                      Cancel
                    </Dialog.Close>
                    <SubmitButton pending={pending} className="pointer-coarse:h-11 pointer-coarse:px-4">{draft.id ? "Save" : "Add mirror"}</SubmitButton>
                  </div>
                </form>
              </>
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  )
}

type Gc = { blobs: number; bytes: number; manifests: number }

export function GcCard() {
  const [result, setResult] = useState<{ dry: boolean; r: Gc } | null>(null)
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()
  const setNotice = useNotice()
  const go = (dry: boolean) =>
    start(async () => {
      setError(undefined)
      const r = await runRegistryGc(dry)
      if (r.error) return setError(r.error)
      const g = { blobs: r.blobs ?? 0, bytes: r.bytes ?? 0, manifests: r.manifests ?? 0 }
      setResult({ dry, r: g })
      if (!dry) setNotice({ text: `Garbage collection freed ${formatBytes(g.bytes)}.` })
    })
  return (
    <section id="registry-gc" className="flex scroll-mt-24 flex-col gap-3">
      <div className="grid gap-1">
        <h2 className="text-base font-semibold">Garbage collection</h2>
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">
          Removes layers no image uses and untagged images nothing needs, and frees their storage. It runs daily on its
          own and leaves anything newer than 24 hours alone. Items in Trash are purged separately after 7 days.
        </p>
      </div>
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" aria-disabled={pending || undefined} aria-busy={pending} className="aria-disabled:pointer-events-none aria-disabled:opacity-50" onClick={() => !pending && go(true)}>
            <BroomIcon />
            Preview
          </Button>
          <Confirm
            label="Run now"
            question="Deletes the layers and images it finds for good."
            yes="Run garbage collection"
            pending={pending}
            onYes={() => go(false)}
          />
        </div>
        <p role="status" className="text-sm empty:hidden">
          {result && (
            <>
              <span className="font-medium">{result.dry ? "Would remove" : "Removed"}</span>{" "}
              <span className="tabular-nums">
                {result.r.blobs} {result.r.blobs === 1 ? "layer" : "layers"} ({formatBytes(result.r.bytes)}) and {result.r.manifests}{" "}
                {result.r.manifests === 1 ? "image" : "images"}
              </span>
              .
            </>
          )}
        </p>
        <FormError>{error}</FormError>
      </div>
    </section>
  )
}

export type QueueItem = BuildItem & { name: string }
export type FailureItem = { id: string; status: string; reason: string | null; ref: string | null; finishedAt: string | null; name: string }

const LIST = "flex flex-col divide-y rounded-xl border bg-card"

// Admin → Container registry → Builds: the cache, what is queued or running, and what went wrong lately.
export function BuildsAdmin({ cacheBytes, cacheLimit, queue, failures }: { cacheBytes: number | null; cacheLimit: number; queue: QueueItem[]; failures: FailureItem[] }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string>()
  const setNotice = useNotice()
  const pct = cacheBytes === null ? 0 : Math.min(100, Math.round((cacheBytes / cacheLimit) * 100))
  return (
    <div className="flex flex-col gap-6">
      <section id="registry-build-cache" className="flex scroll-mt-24 flex-col gap-3" aria-labelledby="build-cache-heading">
        <div className="grid gap-1">
          <h3 id="build-cache-heading" className="text-sm font-semibold">
            Build cache
          </h3>
          <p className="max-w-prose text-sm text-pretty text-muted-foreground">
            Layers kept between builds so the next one is fast. Cleaning it makes the next builds slower, once.
          </p>
        </div>
        <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="tabular-nums">
              {cacheBytes === null ? "Not measured yet" : `${formatBytes(cacheBytes)} of ${formatBytes(cacheLimit)}`}
            </span>
            {cacheBytes !== null && <span className="text-muted-foreground tabular-nums">{pct}%</span>}
          </div>
          <div role="progressbar" aria-label="Build cache used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-2 overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full rounded-full", pct >= 90 ? "bg-destructive" : "bg-primary")} style={{ width: `${pct}%` }} />
          </div>
          <div>
            <Confirm
              label="Clean build cache"
              question="Deletes the cached layers."
              yes="Clean the cache"
              danger={false}
              pending={pending}
              onYes={() =>
                start(async () => {
                  setError(undefined)
                  const r = await cleanBuildCache()
                  if (r.error) return setError(r.error)
                  setNotice({ text: `Cleaned the build cache. Freed ${formatBytes(r.freed ?? 0)}.` })
                })
              }
            />
          </div>
          <FormError>{error}</FormError>
        </div>
      </section>

      <section id="registry-build-queue" className="flex scroll-mt-24 flex-col gap-3" aria-labelledby="build-queue-heading">
        <h3 id="build-queue-heading" className="text-sm font-semibold">
          Running and waiting <span className="font-normal text-muted-foreground tabular-nums">{queue.length}</span>
        </h3>
        {queue.length === 0 ? (
          <p className="rounded-xl border border-dashed border-input px-6 py-8 text-center text-sm text-muted-foreground">No builds are running or waiting.</p>
        ) : (
          <ul className={LIST}>
            {queue.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <div className="grid min-w-0 flex-1 basis-56 gap-1">
                  <Link href={detailHref(b.name, b.id)} className="w-fit max-w-full rounded-sm font-mono text-sm break-all underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50">
                    {b.name}
                    {b.ref ? `@${b.ref}` : ""}
                  </Link>
                  <p suppressHydrationWarning className="text-xs text-muted-foreground">
                    {b.who ?? "A push or schedule"} · queued {ago(b.createdAt)}
                    {b.reason ? ` · ${b.reason}` : ""}
                  </p>
                </div>
                <StatusChip status={b.status} startedAt={b.startedAt} createdAt={b.createdAt} />
                <ConfirmAction label="Cancel" aria={`Cancel the build of ${b.name}`} question="Stop this build?" yes="Stop build" done="Build cancelled." run={adminCancelBuild.bind(null, b.id)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <FailureList
        id="registry-build-failures"
        title="Recent failures"
        empty="No failed builds lately."
        items={failures.filter((f) => f.status !== "stopped")}
      />
      <FailureList
        id="registry-build-stopped"
        title="Stopped to protect the server"
        hint="The guard ended these builds because memory or disk ran low. They can be rebuilt, and are not the repository's fault."
        empty="No builds were stopped lately."
        items={failures.filter((f) => f.status === "stopped")}
      />
    </div>
  )
}

function FailureList({ id, title, hint, empty, items }: { id: string; title: string; hint?: string; empty: string; items: FailureItem[] }) {
  return (
    <section id={id} className="flex scroll-mt-24 flex-col gap-3" aria-labelledby={`${id}-heading`}>
      <div className="grid gap-1">
        <h3 id={`${id}-heading`} className="text-sm font-semibold">
          {title}
        </h3>
        {hint && <p className="max-w-prose text-sm text-pretty text-muted-foreground">{hint}</p>}
      </div>
      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-input px-6 py-8 text-center text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className={LIST}>
          {items.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
              <div className="grid min-w-0 flex-1 basis-56 gap-0.5">
                <Link href={detailHref(f.name, f.id)} className="w-fit max-w-full rounded-sm font-mono text-sm break-all underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50">
                  {f.name}
                  {f.ref ? `@${f.ref}` : ""}
                </Link>
                <p className="text-xs text-pretty text-muted-foreground">{(f.reason ?? (f.status === "stopped" ? "Stopped to protect the server" : "Failed")).replace(/^Stopped to protect the server:\s*/i, "")}</p>
              </div>
              <Badge variant="outline" className={f.status === "failed" ? "text-destructive" : "text-warning"}>
                {f.status === "stopped" ? "Stopped" : "Failed"}
              </Badge>
              <span suppressHydrationWarning className="text-xs text-muted-foreground">
                {f.finishedAt ? ago(f.finishedAt) : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
