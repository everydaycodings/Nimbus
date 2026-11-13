"use client"

import { UploadSimpleIcon } from "@phosphor-icons/react"
import { useRef, useState } from "react"

import { api, errorText } from "@/components/secrets/client"
import type { Detail } from "@/components/secrets/project-view"
import { CHECKBOX, Modal, SELECT } from "@/components/secrets/ui"
import { useNotice } from "@/components/toaster"
import { SubmitButton } from "@/components/submit-button"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

type Row = { key: string; value: string; status: "new" | "changed" | "same" | "duplicate" }
type Preview = { rows: Row[]; errors: string[] }

const BADGE: Record<Row["status"], string> = {
  new: "bg-success/15 text-success",
  changed: "bg-warning/15 text-warning",
  same: "bg-muted text-muted-foreground",
  duplicate: "bg-destructive/15 text-destructive",
}

// Paste or upload .env, JSON or YAML, see what each key would do, then choose
// Overwrite or Skip per key. Or copy keys over from another environment.
export function ImportDialog({
  detail,
  envId,
  folderId,
  initialText,
  onClose,
  onDone,
}: {
  detail: Detail
  envId: string
  folderId: string | null
  initialText: string
  onClose: () => void
  onDone: () => void
}) {
  const notify = useNotice()
  const file = useRef<HTMLInputElement>(null)
  const [text, setText] = useState(initialText)
  const [name, setName] = useState("")
  const [preview, setPreview] = useState<Preview | null>(null)
  const [skip, setSkip] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const others = detail.envs.filter((e) => e.id !== envId)
  const [from, setFrom] = useState(others[0]?.id ?? "")
  const [withValues, setWithValues] = useState(false)

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const doPreview = (t = text, n = name) =>
    run(async () => {
      const r = await api<Preview>(`/projects/${detail.id}/secrets/import`, "POST", {
        mode: "preview",
        envId,
        folderId,
        text: t,
        name: n,
      })
      setPreview(r)
      // Keys that wouldn't change anything start as skipped.
      setSkip(new Set(r.rows.filter((x) => x.status === "same").map((x) => x.key)))
    })

  // Earlier copies of a repeated key are marked duplicate; the last one counts.
  const live = preview?.rows.filter((r) => r.status !== "duplicate" && !skip.has(r.key)) ?? []

  return (
    <Modal
      wide
      title="Import secrets"
      description="Paste a .env or choose a .env, JSON or YAML file. Nested keys become KEY_SUB_KEY."
      onClose={onClose}
    >
      {!preview ? (
        <>
          <div className="grid gap-2">
            <Label htmlFor="import-text">Paste here</Label>
            <textarea
              id="import-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"API_URL=https://example.com\nDEBUG=false"}
              spellCheck={false}
              rows={8}
              className="w-full rounded-md border border-input bg-transparent p-3 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={file}
              type="file"
              hidden
              accept=".env,.json,.yaml,.yml,.txt,text/*,application/json"
              aria-label="Choose a file"
              onChange={async (e) => {
                const f = e.target.files?.[0]
                if (!f) return
                const t = await f.text()
                setText(t)
                setName(f.name)
                doPreview(t, f.name)
              }}
            />
            <Button variant="outline" onClick={() => file.current?.click()}>
              <UploadSimpleIcon />
              Upload a file
            </Button>
            <SubmitButton type="button" pending={busy} disabled={!text.trim()} onClick={() => doPreview()} className="ml-auto">
              Preview
            </SubmitButton>
          </div>

          {others.length > 0 && (
            <div className="grid gap-2 border-t pt-4">
              <Label htmlFor="copy-from">Or copy keys from another environment</Label>
              <p className="text-xs text-muted-foreground">
                Adds the keys it has that this folder lacks. Existing secrets stay as they are.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <select id="copy-from" className={cn(SELECT, "w-auto min-w-40")} value={from} onChange={(e) => setFrom(e.target.value)}>
                  {others.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className={CHECKBOX} checked={withValues} onChange={(e) => setWithValues(e.target.checked)} />
                  With their values
                </label>
                <Button
                  variant="outline"
                  className="ml-auto"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const r = await api<{ count: number }>(`/projects/${detail.id}/secrets/bulk`, "POST", {
                        action: "copy-keys",
                        fromEnvId: from,
                        envId,
                        folderId,
                        withValues,
                      })
                      notify({ text: r.count ? `Copied ${r.count} key${r.count === 1 ? "" : "s"}${withValues ? "" : ", empty"}.` : "Nothing new to copy." })
                      onDone()
                    })
                  }
                >
                  Copy keys
                </Button>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          {preview.errors.length > 0 && (
            <ul className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
              {preview.errors.slice(0, 5).map((e) => (
                <li key={e}>{e}</li>
              ))}
              {preview.errors.length > 5 && <li>and {preview.errors.length - 5} more</li>}
            </ul>
          )}
          <p className="text-sm text-muted-foreground" role="status">
            {preview.rows.filter((r) => r.status === "new").length} new ·{" "}
            {preview.rows.filter((r) => r.status === "changed").length} changed ·{" "}
            {preview.rows.filter((r) => r.status === "same").length} same ·{" "}
            {preview.rows.filter((r) => r.status === "duplicate").length} duplicate
          </p>
          <ul className="max-h-80 divide-y overflow-y-auto rounded-lg border">
            {preview.rows.map((r, i) => (
              <li key={i} className="flex items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1 truncate font-mono text-sm">{r.key}</span>
                <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", BADGE[r.status])}>
                  {r.status === "duplicate" ? "Duplicate (later one wins)" : r.status}
                </span>
                {r.status !== "duplicate" && (
                  <select
                    aria-label={`What to do with ${r.key}`}
                    value={skip.has(r.key) ? "skip" : "go"}
                    onChange={(e) =>
                      setSkip((s) => {
                        const n = new Set(s)
                        if (e.target.value === "skip") n.add(r.key)
                        else n.delete(r.key)
                        return n
                      })
                    }
                    className={cn(SELECT, "h-8 w-28")}
                  >
                    <option value="go">{r.status === "new" ? "Add" : "Overwrite"}</option>
                    <option value="skip">Skip</option>
                  </select>
                )}
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPreview(null)}>
              Back
            </Button>
            <SubmitButton
              type="button"
              pending={busy}
              disabled={!live.length}
              onClick={() =>
                run(async () => {
                  const r = await api<{ created: string[]; updated: string[] }>(
                    `/projects/${detail.id}/secrets/import`,
                    "POST",
                    { mode: "apply", envId, folderId, items: live.map((x) => ({ key: x.key, value: x.value })) }
                  )
                  notify({ text: `Imported: ${r.created.length} new, ${r.updated.length} changed.` })
                  onDone()
                })
              }
            >
              Import {live.length} secret{live.length === 1 ? "" : "s"}
            </SubmitButton>
          </div>
        </>
      )}
      <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
    </Modal>
  )
}
