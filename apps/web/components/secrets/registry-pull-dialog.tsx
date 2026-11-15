"use client"

import { useEffect, useState } from "react"

import { registryRepoChoices } from "@/app/(app)/registry/actions"
import { api, errorText } from "@/components/secrets/client"
import { useBusy } from "@/components/secrets/pki-ui"
import { Modal } from "@/components/secrets/ui"
import { SubmitButton } from "@/components/submit-button"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { fmtTtl } from "@/lib/secrets/dyn-consts"

export type PullConn = { id: string; name: string; defaultTtl: number; maxTtl: number; repos?: "all" | string[] }

const FieldError = ({ text }: { text?: string }) => <p role="alert" className="text-xs text-destructive empty:hidden">{text}</p>
const RADIO = "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-sm has-checked:border-ring/60 has-checked:bg-input/30"

// A dynamic secret type with no server to reach: each lease is a short-lived registry pull token.
export function RegistryPullDialog({ base, conn, onClose, onDone }: { base: string; conn?: PullConn; onClose: () => void; onDone: () => void }) {
  const { busy, error, setError, setBusy } = useBusy()
  const [fields, setFields] = useState<Record<string, string>>({})
  const [all, setAll] = useState(conn?.repos ? conn.repos === "all" : true)
  const [chosen, setChosen] = useState<string[]>(Array.isArray(conn?.repos) ? conn.repos : [])
  const [repos, setRepos] = useState<{ id: string; fullName: string }[] | null>(null)
  useEffect(() => {
    registryRepoChoices().then(setRepos, () => setRepos([]))
  }, [])
  const err = (k: string) => fields[k]
  return (
    <Modal
      title={conn ? `Edit ${conn.name}` : "Add registry pull tokens"}
      description="Each lease is a pull-only token for the container registry that stops working when the lease ends. Use it for CI jobs and clusters."
      onClose={onClose}
    >
      <form
        className="grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          setBusy(true)
          setFields({})
          try {
            const body = { name: String(f.get("name")), repos: all ? "all" : chosen, defaultTtl: String(f.get("defaultTtl")), maxTtl: String(f.get("maxTtl")) }
            if (conn) await api(`${base}/${conn.id}`, "PATCH", body)
            else await api(base, "POST", { ...body, engine: "registry-pull" })
            onDone()
            onClose()
          } catch (er) {
            setError(errorText(er))
            setFields((er as { fields?: Record<string, string> }).fields ?? {})
            setBusy(false)
          }
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor="rp-name">Name</Label>
          <Input id="rp-name" name="name" maxLength={60} required autoFocus defaultValue={conn?.name} placeholder="ci-pull" aria-invalid={Boolean(err("name"))} />
          <FieldError text={err("name")} />
        </div>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">Repositories</legend>
          <label className={RADIO}>
            <input type="radio" name="scope" checked={all} onChange={() => setAll(true)} className="mt-0.5 size-4 accent-primary" />
            <span className="grid">
              <span className="font-medium">All repositories</span>
              <span className="text-xs text-pretty text-muted-foreground">Every repository the connection&apos;s creator can pull, including ones made later.</span>
            </span>
          </label>
          <label className={RADIO}>
            <input type="radio" name="scope" checked={!all} onChange={() => setAll(false)} className="mt-0.5 size-4 accent-primary" />
            <span className="grid">
              <span className="font-medium">Only the ones I pick</span>
            </span>
          </label>
          {!all &&
            (repos === null ? (
              <p className="text-xs text-muted-foreground">Loading repositories…</p>
            ) : repos.length === 0 ? (
              <p className="text-xs text-muted-foreground">There are no repositories to pick yet. Push an image first, or choose all repositories.</p>
            ) : (
              <ul className="max-h-48 divide-y overflow-y-auto rounded-md border">
                {repos.map((r) => (
                  <li key={r.id}>
                    <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm pointer-coarse:min-h-11">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={chosen.includes(r.id)}
                        onChange={(e) => setChosen(e.target.checked ? [...chosen, r.id] : chosen.filter((x) => x !== r.id))}
                      />
                      <span className="font-mono break-all">{r.fullName}</span>
                    </label>
                  </li>
                ))}
              </ul>
            ))}
          <FieldError text={err("repos")} />
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="rp-dt">Default lease</Label>
            <Input id="rp-dt" name="defaultTtl" defaultValue={fmtTtl(conn?.defaultTtl ?? 3600)} aria-invalid={Boolean(err("defaultTtl"))} />
            <FieldError text={err("defaultTtl")} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="rp-mt">Longest lease</Label>
            <Input id="rp-mt" name="maxTtl" defaultValue={fmtTtl(conn?.maxTtl ?? 86400)} aria-invalid={Boolean(err("maxTtl"))} />
            <FieldError text={err("maxTtl")} />
          </div>
        </div>
        <p className="text-xs text-pretty text-muted-foreground">Times: 30m, 2h, 7d.</p>
        <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <SubmitButton pending={busy}>{conn ? "Save" : "Add"}</SubmitButton>
        </div>
      </form>
    </Modal>
  )
}
