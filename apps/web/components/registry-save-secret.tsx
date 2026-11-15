"use client"

import { KeyIcon } from "@phosphor-icons/react"
import { useEffect, useId, useState, useTransition } from "react"

import { saveRegistryTokenToSecret } from "@/app/(app)/registry/actions"
import { ApiError, api, errorText } from "@/components/secrets/client"
import { SELECT, TOUCH } from "@/components/registry-ui"
import { SubmitButton } from "@/components/submit-button"
import { FormError } from "@/components/two-factor"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

type Project = { id: string; name: string; role: string }
type Env = { id: string; name: string }

// "Save to Secrets" under a token that was just made: pick where it goes, and it's stored as a secret.
export function SaveToSecrets({ token }: { token: string }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [locked, setLocked] = useState(false)
  const [project, setProject] = useState("")
  const [envs, setEnvs] = useState<Env[]>([])
  const [env, setEnv] = useState("")
  const [error, setError] = useState<string>()
  const [done, setDone] = useState<string>()
  const [pending, start] = useTransition()

  const load = () => {
    setError(undefined)
    setLocked(false)
    api<{ projects: Project[] }>("/projects").then(
      (r) => {
        const mine = r.projects.filter((p) => p.role !== "viewer")
        setProjects(mine)
        setProject((p) => p || mine[0]?.id || "")
      },
      (e) => {
        if (e instanceof ApiError && e.status === 423) setLocked(true)
        else setError(errorText(e))
        setProjects([])
      }
    )
  }
  useEffect(() => {
    if (open && projects === null) load()
  }, [open, projects])
  useEffect(() => {
    if (!project) return setEnvs([])
    let live = true
    api<{ envs: Env[] }>(`/projects/${project}`).then(
      (r) => {
        if (!live) return
        setEnvs(r.envs)
        setEnv(r.envs[0]?.id ?? "")
      },
      (e) => live && setError(errorText(e))
    )
    return () => {
      live = false
    }
  }, [project])

  if (done)
    return (
      <p role="status" className="rounded-md border px-3 py-2 text-sm text-pretty">
        {done}
      </p>
    )
  if (!open)
    return (
      <Button type="button" variant="outline" className={cn(TOUCH, "w-fit")} onClick={() => setOpen(true)}>
        <KeyIcon />
        Save to Secrets
      </Button>
    )
  return (
    <form
      className="grid gap-3 rounded-lg border p-3"
      onSubmit={(e) => {
        e.preventDefault()
        const name = String(new FormData(e.currentTarget).get("name") ?? "")
        setError(undefined)
        start(async () => {
          const r = await saveRegistryTokenToSecret({ token, name, projectId: project, envId: env })
          if (r.locked) return setLocked(true)
          if (r.error) return setError(r.error)
          const where = projects?.find((p) => p.id === project)?.name
          setDone(
            r.requested
              ? `That environment needs approval. A request to add ${name} in ${where} is waiting for a reviewer.`
              : `Saved as ${name} in ${where}, ${envs.find((x) => x.id === env)?.name}.`
          )
        })
      }}
    >
      <p className="text-sm font-medium">Save to Secrets</p>
      {locked ? (
        <div className="grid gap-2 text-sm text-pretty text-muted-foreground">
          <p>Secrets is locked. Unlock it, then come back here. The token stays on this screen.</p>
          <div className="flex flex-wrap gap-2">
            <a href="/secrets" target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: "outline", size: "sm" }), TOUCH)}>
              Open Secrets
            </a>
            <Button type="button" variant="ghost" className={TOUCH} onClick={() => (setProjects(null), load())}>
              Try again
            </Button>
          </div>
        </div>
      ) : projects === null ? (
        <p className="text-sm text-muted-foreground">Loading projects…</p>
      ) : projects.length === 0 ? (
        <FormError>{error ?? "You have no Secrets project you can write to."}</FormError>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-p`}>Project</Label>
              <select id={`${id}-p`} value={project} onChange={(e) => setProject(e.target.value)} className={cn(SELECT, "pointer-coarse:h-11")}>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-e`}>Environment</Label>
              <select id={`${id}-e`} value={env} onChange={(e) => setEnv(e.target.value)} className={cn(SELECT, "pointer-coarse:h-11")}>
                {envs.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-n`}>Name</Label>
            <Input id={`${id}-n`} name="name" defaultValue="NIMBUS_REGISTRY_TOKEN" className="font-mono pointer-coarse:h-11" autoComplete="off" spellCheck={false} />
          </div>
          <FormError>{error}</FormError>
          <div className="flex flex-wrap gap-2">
            <SubmitButton pending={pending} disabled={!env} className={TOUCH}>
              Save
            </SubmitButton>
            <Button type="button" variant="ghost" className={TOUCH} disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </form>
  )
}
