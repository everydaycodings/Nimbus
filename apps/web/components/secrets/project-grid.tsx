"use client"

import { Dialog } from "@base-ui/react/dialog"
import { KeyIcon, PlusIcon, StackIcon } from "@phosphor-icons/react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { DIALOG_BACKDROP, DIALOG_POPUP } from "@/components/overlay-styles"
import { api, errorText } from "@/components/secrets/client"
import { SubmitButton } from "@/components/submit-button"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { ProjectCard } from "@/lib/secrets/service"

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`

export function ProjectGrid({
  projects,
  limit,
}: {
  projects: ProjectCard[]
  limit: number | null
}) {
  const [creating, setCreating] = useState(false)
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-auto flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Secrets</h1>
          <p className="max-w-prose text-sm text-pretty text-muted-foreground">
            Environment variables and keys, grouped by project and environment.
            Values are sealed on the server and only open while you&apos;re unlocked.
          </p>
        </div>
        {limit === null && (
          <Button onClick={() => setCreating(true)}>
            <PlusIcon />
            New project
          </Button>
        )}
      </div>
      {limit !== null && (
        <p className="text-sm text-muted-foreground">
          You have the most projects allowed here ({limit}).
        </p>
      )}

      {projects.length ? (
        <ul className="grid gap-gap-ui sm:grid-cols-[repeat(auto-fill,minmax(16rem,1fr))]">
          {projects.map((p) => (
            <li key={p.id}>
              <Link
                href={`/secrets/${p.id}`}
                className="flex h-full items-start gap-3 rounded-xl border p-4 transition-colors outline-none hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">
                  <StackIcon className="size-5" />
                </span>
                <span className="grid min-w-0 gap-0.5">
                  <span className="truncate font-medium">{p.name}</span>
                  {p.description && (
                    <span className="line-clamp-2 text-xs text-pretty text-muted-foreground">
                      {p.description}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {plural(p.secrets, "secret")} · {plural(p.envs, "environment")}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
          <KeyIcon weight="light" className="size-12 text-muted-foreground" />
          <p className="font-medium">No projects yet</p>
          <p className="max-w-sm text-sm text-pretty text-muted-foreground">
            A project holds the secrets for one app, with Development, Staging and
            Production ready to fill.
          </p>
          {limit === null && (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon />
              New project
            </Button>
          )}
        </div>
      )}
      {creating && <NewProject onClose={() => setCreating(false)} />}
    </div>
  )
}

function NewProject({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={DIALOG_POPUP}>
          <Dialog.Title className="text-base font-semibold">New project</Dialog.Title>
          <form
            className="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault()
              const f = new FormData(e.currentTarget)
              setBusy(true)
              setError(null)
              try {
                const { id } = await api<{ id: string }>("/projects", "POST", {
                  name: f.get("name"),
                  description: f.get("description"),
                })
                router.push(`/secrets/${id}`)
              } catch (err) {
                setError(errorText(err))
                setBusy(false)
              }
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="project-name">Name</Label>
              <Input id="project-name" name="name" maxLength={80} autoFocus required placeholder="Billing API" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="project-desc">Description (optional)</Label>
              <Input id="project-desc" name="description" maxLength={300} />
            </div>
            <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <SubmitButton pending={busy}>Create project</SubmitButton>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
