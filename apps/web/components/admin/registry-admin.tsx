"use client"

import { Dialog } from "@base-ui/react/dialog"
import { BroomIcon, PencilSimpleIcon, PlusIcon } from "@phosphor-icons/react"
import { useId, useState, useTransition } from "react"

import { deleteRegistryMirror, runRegistryGc, saveRegistryMirror } from "@/app/(app)/admin/actions"
import { DIALOG_BACKDROP, DIALOG_POPUP } from "@/components/overlay-styles"
import { ConfirmAction } from "@/components/admin/registry-actions"
import { Confirm } from "@/components/registry-ui"
import { SubmitButton } from "@/components/submit-button"
import { useNotice } from "@/components/toaster"
import { FormError } from "@/components/two-factor"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatBytes } from "@/lib/file-rules"
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
