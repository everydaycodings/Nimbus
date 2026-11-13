"use client"

import {
  ArrowArcLeftIcon,
  CaretDownIcon,
  CheckIcon,
  CopyIcon,
  DotsThreeIcon,
  DownloadSimpleIcon,
  EyeIcon,
  EyeSlashIcon,
  ClockCounterClockwiseIcon,
  FolderPlusIcon,
  FolderSimpleIcon,
  PencilSimpleIcon,
  ShareNetworkIcon,
  ShieldCheckIcon,
  PlusIcon,
  TagIcon,
  TrashIcon,
  UploadSimpleIcon,
  UserIcon,
  WarningIcon,
} from "@phosphor-icons/react"
import { PwnedHint } from "@/components/secrets/pwned-hint"
import { looksLikePassword } from "@/lib/secrets/pwned-rules"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  ApiError,
  api,
  copySecret,
  download,
  errorText,
  generateValue,
  type CharSet,
} from "@/components/secrets/client"
import { FolderBar } from "@/components/secrets/folder-bar"
import { HistoryDialog } from "@/components/secrets/history-dialog"
import { ShareDialog } from "@/components/secrets/share-dialog"
import { ImportDialog } from "@/components/secrets/import-dialog"
import type { Detail } from "@/components/secrets/project-view"
import { CHECKBOX, Confirm, MenuButton, Modal, SELECT } from "@/components/secrets/ui"
import { SubmitButton } from "@/components/submit-button"
import { useNotice } from "@/components/toaster"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SECRET_TYPES } from "@/lib/secrets/consts"
import type { SecretRow } from "@/lib/secrets/service"
import { cn } from "@/lib/utils"

type Draft = {
  key: string
  value: string
  comment: string
  type: string
  rotationAt: string
  tags: string[]
}
type Shown = {
  value: string
  override: string | null
  resolved: string | null
  problems: string[]
}
type Fresh = { tid: string; draft: Draft }

const blank = (key = ""): Draft => ({ key, value: "", comment: "", type: "", rotationAt: "", tags: [] })
const baseOf = (r: SecretRow): Omit<Draft, "value"> => ({
  key: r.key,
  comment: r.comment ?? "",
  type: r.type ?? "",
  rotationAt: r.rotationAt ?? "",
  tags: r.tags,
})
const MASK = "••••••••"
const parentOf = (path: string) => path.split("/").slice(0, -1).join("/")
const day = new Intl.DateTimeFormat("en", { dateStyle: "medium" })
const sameTags = (a: string[], b: string[]) => a.length === b.length && a.every((t, i) => t === b[i])

export function SecretsTable({
  detail,
  env,
  folder,
  canWrite,
  onFolder,
  addKey,
  onOpenRequests,
  onChanged,
}: {
  detail: Detail
  env: Detail["envs"][number]
  folder: string
  canWrite: boolean
  onFolder: (p: string) => void
  addKey: string | null
  onOpenRequests: () => void
  onChanged: () => void
}) {
  const notify = useNotice()
  const base = `/projects/${detail.id}`
  const folderRow = detail.folders.find((f) => f.envId === env.id && f.path === folder)
  const folderId = folderRow?.id ?? null
  const childFolders = detail.folders.filter((f) => f.envId === env.id && parentOf(f.path) === folder)
  const allFolders = detail.folders.filter((f) => f.envId === env.id)

  const [rows, setRows] = useState<SecretRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<string, Partial<Draft>>>({})
  const [fresh, setFresh] = useState<Fresh[]>(() => (addKey ? [{ tid: "n0", draft: blank(addKey) }] : []))
  const [removed, setRemoved] = useState<Set<string>>(new Set())
  const [shown, setShown] = useState<Record<string, Shown>>({})
  const [open, setOpen] = useState<string | null>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [dialog, setDialog] = useState<
    | { kind: "import"; text: string }
    | { kind: "folder" }
    | { kind: "rename-folder"; id: string; name: string }
    | { kind: "delete-folder"; id: string; name: string }
    | { kind: "move" }
    | { kind: "copy" }
    | { kind: "tag" }
    | { kind: "history"; id: string; key: string }
    | { kind: "share"; id: string; key: string }
    | null
  >(null)
  const nextId = useRef(1)

  const load = useCallback(async () => {
    try {
      const r = await api<{ secrets: SecretRow[] }>(
        `${base}/secrets?env=${env.slug}&folder=${encodeURIComponent(folder)}`
      )
      setRows(r.secrets)
      setLoadError(null)
      setEdits({})
      setRemoved(new Set())
      setErrors({})
      setShown({})
      setSel(new Set())
      setFresh([])
      api<{ tags: string[] }>(`${base}/tags`).then((t) => setTags(t.tags)).catch(() => {})
    } catch (e) {
      setLoadError(errorText(e))
    }
  }, [base, env.slug, folder])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads once per env and folder
    load().then(() => addKey && setFresh([{ tid: "n0", draft: blank(addKey) }]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load])

  const changes =
    Object.keys(edits).length +
    removed.size +
    fresh.filter((f) => f.draft.key.trim() || f.draft.value).length

  const patch = (r: SecretRow, p: Partial<Draft>) =>
    setEdits((all) => {
      const next = { ...(all[r.id] ?? {}), ...p }
      const b = baseOf(r)
      // Drop fields that went back to what's saved.
      for (const k of Object.keys(next) as (keyof Draft)[]) {
        if (k === "value") continue
        const same = k === "tags" ? sameTags(next.tags!, b.tags) : next[k] === b[k]
        if (same) delete next[k]
      }
      const rest = { ...all }
      if (Object.keys(next).length) rest[r.id] = next
      else delete rest[r.id]
      return rest
    })

  async function reveal(ids: string[], purpose: "reveal" | "copy" = "reveal") {
    const r = await api<{ values: (Shown & { id: string })[] }>(`${base}/secrets/reveal`, "POST", { ids, purpose })
    return r.values
  }

  async function revealRow(id: string) {
    try {
      const [v] = await reveal([id])
      setShown((s) => ({ ...s, [id]: v }))
    } catch (e) {
      notify({ text: errorText(e), error: true })
    }
  }

  async function revealAll() {
    if (!rows?.length) return
    try {
      const values = await reveal(rows.map((r) => r.id))
      setShown(Object.fromEntries(values.map((v) => [v.id, v])))
    } catch (e) {
      notify({ text: errorText(e), error: true })
    }
  }

  async function copyRow(r: SecretRow) {
    try {
      const [v] = await reveal([r.id], "copy")
      await copySecret(v.override ?? v.value)
      notify({ text: `Copied ${r.key}. The clipboard clears in 30 seconds.` })
    } catch (e) {
      notify({ text: errorText(e), error: true })
    }
  }

  async function save() {
    if (!rows) return
    const ops: object[] = []
    const owners: string[] = []
    for (const r of rows) {
      const e = edits[r.id]
      if (!e || removed.has(r.id)) continue
      ops.push({
        id: r.id,
        key: e.key ?? r.key,
        ...(e.value !== undefined && { value: e.value }),
        ...(e.comment !== undefined && { comment: e.comment || null }),
        ...(e.type !== undefined && { type: e.type || null }),
        ...(e.rotationAt !== undefined && { rotationAt: e.rotationAt || null }),
        ...(e.tags !== undefined && { tags: e.tags }),
      })
      owners.push(r.id)
    }
    for (const f of fresh) {
      if (!f.draft.key.trim() && !f.draft.value) continue
      const d = f.draft
      ops.push({
        key: d.key.trim(),
        value: d.value,
        comment: d.comment || null,
        type: d.type || null,
        rotationAt: d.rotationAt || null,
        tags: d.tags,
      })
      owners.push(f.tid)
    }
    setSaving(true)
    setSaveError(null)
    setErrors({})
    try {
      const r = await api<{ request?: { id: string } }>(`${base}/secrets`, "POST", { envId: env.id, folderId, ops, deletes: [...removed] })
      notify({ text: r.request ? "Sent for review. It goes live once approved and merged." : "Saved." })
      await load()
      onChanged()
    } catch (e) {
      if (e instanceof ApiError && e.fields) {
        const mapped: Record<string, string> = {}
        for (const [i, msg] of Object.entries(e.fields)) if (owners[Number(i)]) mapped[owners[Number(i)]] = msg
        setErrors(mapped)
        setSaveError(Object.keys(mapped).length ? "Fix the marked rows and save again." : e.message)
      } else setSaveError(errorText(e))
    } finally {
      setSaving(false)
    }
  }

  async function bulk(body: object, done: (r: Record<string, number>) => string) {
    try {
      const r = await api<Record<string, number>>(`${base}/secrets/bulk`, "POST", body)
      notify({ text: r.requests ? "Sent for review. It goes live once approved and merged." : done(r) })
      await load()
      onChanged()
    } catch (e) {
      notify({ text: errorText(e), error: true })
    }
  }

  async function exportSecrets(format: "env" | "json" | "yaml", ids?: string[]) {
    try {
      const res = await fetch(`/api/v1/secrets${base}/secrets/export`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(ids ? { format, ids } : { format, envId: env.id, folderId }),
      })
      if (!res.ok) throw new Error(((await res.json()) as { message?: string }).message ?? "Couldn't export.")
      const ext = format === "env" ? "env" : format
      download(`${detail.name}-${env.slug}${folder ? `-${folder.replace(/\//g, "-")}` : ""}.${format === "env" ? "env" : ext}`.replace(/\s+/g, "-"), await res.text(), res.headers.get("content-type") ?? "text/plain")
    } catch (e) {
      notify({ text: errorText(e), error: true })
    }
  }

  const pastes = (text: string) => /^\s*(export\s+)?[A-Za-z_]\w*\s*=/m.test(text)
  const addRow = () => setFresh((f) => [{ tid: `n${nextId.current++}`, draft: blank() }, ...f])
  const patchFresh = (tid: string, p: Partial<Draft>) =>
    setFresh((all) => all.map((f) => (f.tid === tid ? { ...f, draft: { ...f.draft, ...p } } : f)))

  const visible = useMemo(() => rows ?? [], [rows])
  const picked = [...sel]
  const allSelected = visible.length > 0 && visible.every((r) => sel.has(r.id))

  if (loadError) return <p role="alert" className="text-sm text-destructive">{loadError}</p>

  return (
    <div
      className="flex flex-col gap-4"
      onPaste={(e) => {
        const t = e.target as HTMLElement
        if (!canWrite || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
        const text = e.clipboardData.getData("text")
        if (pastes(text)) {
          e.preventDefault()
          setDialog({ kind: "import", text })
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto flex min-w-0 items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">{env.name}</h2>
          <FolderBar root="Top level" path={folder} onOpen={onFolder} />
        </div>
        {canWrite && (
          <>
            <Button onClick={addRow}>
              <PlusIcon />
              Add secret
            </Button>
            <Button variant="outline" onClick={() => setDialog({ kind: "import", text: "" })}>
              <UploadSimpleIcon />
              Import
            </Button>
            <Button variant="outline" onClick={() => setDialog({ kind: "folder" })}>
              <FolderPlusIcon />
              New folder
            </Button>
          </>
        )}
        <Button
          variant="outline"
          onClick={() => (Object.keys(shown).length ? setShown({}) : revealAll())}
          disabled={!visible.length}
        >
          {Object.keys(shown).length ? <EyeSlashIcon /> : <EyeIcon />}
          {Object.keys(shown).length ? "Hide all" : "Reveal all"}
        </Button>
        <MenuButton
          label="Export this folder"
          className="h-9 border px-3"
          trigger={
            <>
              <DownloadSimpleIcon />
              Export
              <CaretDownIcon className="size-3" />
            </>
          }
          items={(["env", "json", "yaml"] as const).map((f) => ({
            label: f === "env" ? ".env" : f.toUpperCase(),
            onClick: () => exportSecrets(f),
          }))}
        />
      </div>

      {env.protected && (
        <p className="flex flex-wrap items-center gap-x-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
          <ShieldCheckIcon className="size-4 shrink-0 text-brand" weight="fill" />
          <span>{env.name} is protected: edits go to review first.</span>
          <button className="underline underline-offset-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" onClick={onOpenRequests}>
            Change requests
          </button>
        </p>
      )}

      {sel.size > 0 && (
        <div
          role="toolbar"
          aria-label="Bulk actions"
          className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2"
        >
          <span className="mr-2 text-sm font-medium tabular-nums">{sel.size} selected</span>
          {canWrite && (
            <>
              <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "move" })}>
                <FolderSimpleIcon />
                Move to folder
              </Button>
              <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "copy" })}>
                <CopyIcon />
                Copy to environment
              </Button>
              <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "tag" })}>
                <TagIcon />
                Tag
              </Button>
            </>
          )}
          <MenuButton
            label="Export selected"
            className="h-7 border px-2.5"
            trigger={
              <>
                <DownloadSimpleIcon className="size-3.5" />
                Export selected
              </>
            }
            items={(["env", "json", "yaml"] as const).map((f) => ({
              label: f === "env" ? ".env" : f.toUpperCase(),
              onClick: () => exportSecrets(f, picked),
            }))}
          />
          {canWrite && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() =>
                bulk({ action: "delete", ids: picked }, (r) => `Moved ${r.count} to the trash.`)
              }
            >
              <TrashIcon />
              Delete
            </Button>
          )}
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setSel(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {childFolders.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]">
          {childFolders.map((f) => (
            <li key={f.id} className="flex items-center rounded-lg border hover:bg-muted/40">
              <button
                onClick={() => onFolder(f.path)}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <FolderSimpleIcon weight="fill" className="size-4 shrink-0 text-file-folder" />
                <span className="truncate">{f.name}</span>
              </button>
              {canWrite && (
                <MenuButton
                  label={`Folder ${f.name}`}
                  className="mr-1 size-7"
                  trigger={<DotsThreeIcon weight="bold" />}
                  items={[
                    { label: "Rename", icon: <PencilSimpleIcon />, onClick: () => setDialog({ kind: "rename-folder", id: f.id, name: f.name }) },
                    { label: "Delete", icon: <TrashIcon />, danger: true, separator: true, onClick: () => setDialog({ kind: "delete-folder", id: f.id, name: f.name }) },
                  ]}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {rows === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : visible.length === 0 && fresh.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-14 text-center">
          <p className="font-medium">No secrets in {folder ? folder : env.name} yet</p>
          <p className="max-w-sm text-sm text-pretty text-muted-foreground">
            {canWrite
              ? "Add one, or paste a .env anywhere on this page to import it."
              : "Nothing has been added here."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <div className="hidden grid-cols-[auto_minmax(9rem,16rem)_minmax(0,1fr)_auto] items-center gap-x-3 border-b bg-muted/30 px-3 py-2 text-xs text-muted-foreground sm:grid">
            <input
              type="checkbox"
              className={CHECKBOX}
              aria-label="Select all"
              checked={allSelected}
              onChange={(e) => setSel(e.target.checked ? new Set(visible.map((r) => r.id)) : new Set())}
            />
            <span>Key</span>
            <span>Value</span>
            <span className="w-36" />
          </div>
          <ul>
            {fresh.map((f) => (
              <Line
                key={f.tid}
                id={f.tid}
                isNew
                draft={f.draft}
                base={null}
                shown={null}
                error={errors[f.tid]}
                removed={false}
                selected={false}
                expanded={open === f.tid}
                canWrite={canWrite}
                tagChoices={tags}
                onPatch={(p) => patchFresh(f.tid, p)}
                onSelect={() => {}}
                onExpand={() => setOpen(open === f.tid ? null : f.tid)}
                onReveal={() => {}}
                onHide={() => {}}
                onCopy={() => copySecret(f.draft.value).then(() => notify({ text: "Copied. The clipboard clears in 30 seconds." }))}
                onRemove={() => setFresh((all) => all.filter((x) => x.tid !== f.tid))}
                onUndo={() => {}}
                onKeyPaste={(t) => {
                  if (!pastes(t)) return false
                  setDialog({ kind: "import", text: t })
                  return true
                }}
                onOverride={async () => {}}
                onHistory={() => {}}
                onShare={() => {}}
              />
            ))}
            {visible.map((r) => {
              const e = edits[r.id] ?? {}
              const draft: Draft = { ...baseOf(r), ...e, value: e.value ?? shown[r.id]?.value ?? "" }
              return (
                <Line
                  key={r.id}
                  id={r.id}
                  isNew={false}
                  draft={draft}
                  base={r}
                  shown={shown[r.id] ?? null}
                  error={errors[r.id]}
                  removed={removed.has(r.id)}
                  selected={sel.has(r.id)}
                  expanded={open === r.id}
                  canWrite={canWrite}
                  tagChoices={tags}
                  onPatch={(p) => patch(r, p)}
                  onSelect={(on) =>
                    setSel((s) => {
                      const n = new Set(s)
                      if (on) n.add(r.id)
                      else n.delete(r.id)
                      return n
                    })
                  }
                  onExpand={() => setOpen(open === r.id ? null : r.id)}
                  onReveal={() => revealRow(r.id)}
                  onHide={() =>
                    setShown((s) => {
                      const n = { ...s }
                      delete n[r.id]
                      return n
                    })
                  }
                  onCopy={() => copyRow(r)}
                  onRemove={() => setRemoved((s) => new Set(s).add(r.id))}
                  onUndo={() =>
                    setRemoved((s) => {
                      const n = new Set(s)
                      n.delete(r.id)
                      return n
                    })
                  }
                  onKeyPaste={() => false}
                  onHistory={() => setDialog({ kind: "history", id: r.id, key: r.key })}
                  onShare={() => setDialog({ kind: "share", id: r.id, key: r.key })}
                  onOverride={async (value) => {
                    try {
                      await api(`${base}/secrets/override`, "PUT", { id: r.id, value })
                      notify({ text: value === null ? "Removed your override." : "Saved your own value." })
                      await load()
                      await revealRow(r.id)
                    } catch (err) {
                      notify({ text: errorText(err), error: true })
                    }
                  }}
                />
              )
            })}
          </ul>
        </div>
      )}

      {changes > 0 && (
        <div
          role="region"
          aria-label="Unsaved changes"
          className="sticky bottom-3 z-20 flex flex-wrap items-center gap-3 rounded-xl border bg-popover px-4 py-3 shadow-lg"
        >
          <p className="mr-auto text-sm" role="status">
            <span className="font-medium tabular-nums">{changes}</span> unsaved change{changes === 1 ? "" : "s"}
            {saveError && <span className="ml-2 text-destructive">{saveError}</span>}
          </p>
          <Button variant="outline" onClick={load} disabled={saving}>
            Discard
          </Button>
          <SubmitButton type="button" pending={saving} onClick={save}>
            Save changes
          </SubmitButton>
        </div>
      )}

      {dialog?.kind === "import" && (
        <ImportDialog
          detail={detail}
          envId={env.id}
          folderId={folderId}
          initialText={dialog.text}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null)
            load()
            onChanged()
          }}
        />
      )}
      {dialog?.kind === "history" && (
        <HistoryDialog
          projectId={detail.id}
          secretId={dialog.id}
          keyName={dialog.key}
          canWrite={canWrite}
          admin={detail.role === "admin"}
          onClose={() => setDialog(null)}
          onChanged={() => {
            load()
            onChanged()
          }}
        />
      )}
      {dialog?.kind === "share" && (
        <ShareDialog from={{ projectId: detail.id, secretId: dialog.id, key: dialog.key }} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "folder" && (
        <NameDialog
          title="New folder"
          action="Create folder"
          hint="Letters, numbers, - and _. Reference its secrets as ${env.folder.KEY}."
          onClose={() => setDialog(null)}
          run={async (name) => {
            await api(`${base}/folders`, "POST", { envId: env.id, parentId: folderId, name })
            onChanged()
          }}
        />
      )}
      {dialog?.kind === "rename-folder" && (
        <NameDialog
          title="Rename folder"
          action="Rename"
          initial={dialog.name}
          onClose={() => setDialog(null)}
          run={async (name) => {
            await api(`${base}/folders/${dialog.id}`, "PATCH", { name })
            onChanged()
          }}
        />
      )}
      {dialog?.kind === "delete-folder" && (
        <Confirm
          title={`Delete ${dialog.name}?`}
          description="The folder, its subfolders and their secrets go away. The secrets can be restored from the trash to the top level."
          action="Delete folder"
          danger
          run={async () => {
            await api(`${base}/folders/${dialog.id}`, "DELETE")
            onChanged()
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "move" && (
        <PickDialog
          title={`Move ${sel.size} secret${sel.size === 1 ? "" : "s"}`}
          label="Move to"
          action="Move"
          options={[{ value: "", label: "Top level" }, ...allFolders.map((f) => ({ value: f.id, label: f.path }))]}
          onClose={() => setDialog(null)}
          run={async (v) => {
            setDialog(null)
            await bulk({ action: "move", ids: picked, folderId: v || null }, (r) => `Moved ${r.count}.`)
          }}
        />
      )}
      {dialog?.kind === "copy" && (
        <PickDialog
          title={`Copy ${sel.size} secret${sel.size === 1 ? "" : "s"}`}
          label="Copy to environment"
          action="Copy"
          check="Overwrite secrets that already exist there"
          options={detail.envs.filter((e) => e.id !== env.id).map((e) => ({ value: e.id, label: e.name }))}
          onClose={() => setDialog(null)}
          run={async (v, overwrite) => {
            setDialog(null)
            await bulk(
              { action: "copy", ids: picked, toEnvId: v, overwrite },
              (r) => `Copied ${r.copied}${r.skipped ? `, skipped ${r.skipped} that already exist` : ""}.`
            )
          }}
        />
      )}
      {dialog?.kind === "tag" && (
        <TagDialog
          choices={tags}
          onClose={() => setDialog(null)}
          run={async (add, remove) => {
            setDialog(null)
            await bulk({ action: "tag", ids: picked, add, remove }, (r) => `Tagged ${r.count}.`)
          }}
        />
      )}
    </div>
  )
}

function NameDialog({
  title,
  action,
  initial = "",
  hint,
  run,
  onClose,
}: {
  title: string
  action: string
  initial?: string
  hint?: string
  run: (name: string) => Promise<void>
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          try {
            await run(String(new FormData(e.currentTarget).get("name")))
            onClose()
          } catch (err) {
            setError(errorText(err))
            setBusy(false)
          }
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor="name-dialog">Name</Label>
          <Input id="name-dialog" name="name" defaultValue={initial} maxLength={40} required autoFocus />
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
        <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <SubmitButton pending={busy}>{action}</SubmitButton>
        </div>
      </form>
    </Modal>
  )
}

function PickDialog({
  title,
  label,
  action,
  options,
  check,
  run,
  onClose,
}: {
  title: string
  label: string
  action: string
  options: { value: string; label: string }[]
  check?: string
  run: (value: string, checked: boolean) => Promise<void>
  onClose: () => void
}) {
  const [value, setValue] = useState(options[0]?.value ?? "")
  const [checked, setChecked] = useState(false)
  return (
    <Modal title={title} onClose={onClose}>
      <div className="grid gap-2">
        <Label htmlFor="pick">{label}</Label>
        <select id="pick" className={SELECT} value={value} onChange={(e) => setValue(e.target.value)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {check && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className={CHECKBOX} checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          {check}
        </label>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={!options.length} onClick={() => run(value, checked)}>{action}</Button>
      </div>
    </Modal>
  )
}

const splitTags = (s: string) => [...new Set(s.split(",").map((t) => t.trim()).filter(Boolean))]

function TagDialog({
  choices,
  run,
  onClose,
}: {
  choices: string[]
  run: (add: string[], remove: string[]) => Promise<void>
  onClose: () => void
}) {
  const [add, setAdd] = useState("")
  const [remove, setRemove] = useState("")
  return (
    <Modal title="Tag secrets" description="Separate tags with commas." onClose={onClose}>
      <datalist id="tag-choices">
        {choices.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <div className="grid gap-2">
        <Label htmlFor="tags-add">Add tags</Label>
        <Input id="tags-add" list="tag-choices" value={add} onChange={(e) => setAdd(e.target.value)} placeholder="database, prod-only" autoFocus />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="tags-remove">Remove tags</Label>
        <Input id="tags-remove" list="tag-choices" value={remove} onChange={(e) => setRemove(e.target.value)} />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={!splitTags(add).length && !splitTags(remove).length} onClick={() => run(splitTags(add), splitTags(remove))}>
          Apply
        </Button>
      </div>
    </Modal>
  )
}

type LineProps = {
  id: string
  isNew: boolean
  draft: Draft
  base: SecretRow | null
  shown: Shown | null
  error?: string
  removed: boolean
  selected: boolean
  expanded: boolean
  canWrite: boolean
  tagChoices: string[]
  onPatch: (p: Partial<Draft>) => void
  onSelect: (on: boolean) => void
  onExpand: () => void
  onReveal: () => void
  onHide: () => void
  onCopy: () => void
  onRemove: () => void
  onUndo: () => void
  onKeyPaste: (text: string) => boolean
  onOverride: (value: string | null) => Promise<void>
  onHistory: () => void
  onShare: () => void
}

// One secret: key, value (masked until clicked), and a panel for the rest.
function Line(p: LineProps) {
  const { draft: d, base, shown } = p
  const editable = p.canWrite && !p.removed
  const valueVisible = p.isNew || shown !== null || base === null
  const dirty = !p.isNew && base && Object.keys(draftChanges(base, d, shown)).length > 0
  const [own, setOwn] = useState("")
  const [len, setLen] = useState(32)
  const [set, setSet] = useState<CharSet>("alnum")

  return (
    <li className={cn("border-b last:border-0", p.expanded && "bg-muted/20", p.removed && "opacity-60")}>
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 px-3 py-2.5 sm:grid-cols-[auto_minmax(9rem,16rem)_minmax(0,1fr)_auto]">
        <div className="col-start-1 row-start-1 flex h-9 items-center">
          {p.isNew ? (
            <span className="size-4" />
          ) : (
            <input
              type="checkbox"
              className={CHECKBOX}
              aria-label={`Select ${d.key}`}
              checked={p.selected}
              onChange={(e) => p.onSelect(e.target.checked)}
            />
          )}
        </div>

        <div className="col-start-2 row-start-1 grid min-w-0 gap-1">
          <div className="relative">
            <input
              aria-label={p.isNew ? "New secret key" : `Key of ${base?.key}`}
              value={d.key}
              readOnly={!editable}
              placeholder="KEY_NAME"
              spellCheck={false}
              autoCapitalize="off"
              autoFocus={p.isNew && !d.key}
              onChange={(e) => p.onPatch({ key: e.target.value })}
              onPaste={(e) => {
                if (p.onKeyPaste(e.clipboardData.getData("text"))) e.preventDefault()
              }}
              className={cn(
                "h-9 w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 font-mono text-sm outline-none read-only:cursor-default",
                editable && "hover:border-input focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
                p.removed && "line-through",
                p.error && "border-destructive"
              )}
            />
            {dirty && (
              <span className="absolute top-1/2 -left-1.5 size-1.5 -translate-y-1/2 rounded-full bg-brand" title="Unsaved change" />
            )}
          </div>
          <div className="flex min-h-0 flex-wrap items-center gap-1 px-2 text-xs text-muted-foreground empty:hidden">
            {d.type && <span className="rounded bg-muted px-1.5 py-0.5 font-mono">{d.type}</span>}
            {d.tags.map((t) => (
              <span key={t} className="rounded bg-muted px-1.5 py-0.5">{t}</span>
            ))}
            {base?.override && (
              <span className="flex items-center gap-1 rounded bg-brand/10 px-1.5 py-0.5 text-brand">
                <UserIcon className="size-3" />
                Your override
              </span>
            )}
            {d.rotationAt && (
              <span className="rounded bg-warning/10 px-1.5 py-0.5 text-warning">
                Rotate by {day.format(new Date(d.rotationAt))}
              </span>
            )}
            {d.comment && <span className="max-w-full truncate">{d.comment}</span>}
          </div>
        </div>

        <div className="col-span-3 col-start-1 row-start-2 min-w-0 sm:col-span-1 sm:col-start-3 sm:row-start-1">
          {valueVisible ? (
            <textarea
              aria-label={p.isNew ? "New secret value" : `Value of ${base?.key}`}
              value={d.value}
              readOnly={!editable}
              rows={1}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              placeholder="Value"
              onChange={(e) => p.onPatch({ value: e.target.value })}
              className={cn(
                "field-sizing-content block max-h-60 min-h-9 w-full resize-none rounded-md border border-input bg-transparent px-2.5 py-1.5 font-mono text-sm break-all outline-none read-only:cursor-default focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30",
                p.removed && "line-through",
                p.error && "border-destructive"
              )}
            />
          ) : (
            <button
              type="button"
              onClick={p.onReveal}
              aria-label={`Reveal value of ${base?.key}`}
              className="flex h-9 w-full items-center gap-2 rounded-md border border-input px-2.5 text-left font-mono text-sm text-muted-foreground outline-none hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
            >
              <span aria-hidden>{MASK}</span>
              <span className="ml-auto font-sans text-xs">Click to reveal</span>
            </button>
          )}
          {valueVisible && editable && (p.isNew || dirty) && looksLikePassword(d.key) && <PwnedHint value={d.value} />}
        </div>

        <div className="col-start-3 row-start-1 flex items-center gap-0.5 sm:col-start-4">
          {p.removed ? (
            <Button variant="ghost" size="sm" onClick={p.onUndo}>
              <ArrowArcLeftIcon />
              Undo
            </Button>
          ) : (
            <>
              {!p.isNew && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={valueVisible ? `Hide value of ${base?.key}` : `Reveal value of ${base?.key}`}
                  onClick={valueVisible ? p.onHide : p.onReveal}
                >
                  {valueVisible ? <EyeSlashIcon /> : <EyeIcon />}
                </Button>
              )}
              <CopyButton onCopy={p.onCopy} label={d.key || "value"} />
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Details for ${d.key || "new secret"}`}
                aria-expanded={p.expanded}
                onClick={p.onExpand}
              >
                <CaretDownIcon className={cn("transition-transform", p.expanded && "rotate-180")} />
              </Button>
              {p.canWrite && (
                <Button variant="ghost" size="icon-sm" aria-label={`Delete ${d.key || "new secret"}`} onClick={p.onRemove}>
                  <TrashIcon />
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {p.error && (
        <p role="alert" className="flex items-center gap-1.5 px-3 pb-2 pl-10 text-sm text-destructive">
          <WarningIcon className="size-4 shrink-0" />
          {p.error}
        </p>
      )}

      {p.expanded && !p.removed && (
        <div className="grid gap-4 border-t px-3 py-4 pl-10 sm:grid-cols-2">
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor={`c-${p.id}`}>Comment</Label>
            <Input id={`c-${p.id}`} value={d.comment} readOnly={!editable} maxLength={1000} onChange={(e) => p.onPatch({ comment: e.target.value })} placeholder="What this is for" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`t-${p.id}`}>Type</Label>
            <select id={`t-${p.id}`} className={SELECT} disabled={!editable} value={d.type} onChange={(e) => p.onPatch({ type: e.target.value })}>
              <option value="">Any text</option>
              {SECRET_TYPES.filter((t) => t !== "string").map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">The value is checked against it when you save.</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`r-${p.id}`}>Rotation reminder</Label>
            <Input id={`r-${p.id}`} type="date" value={d.rotationAt} readOnly={!editable} onChange={(e) => p.onPatch({ rotationAt: e.target.value })} />
            <p className="text-xs text-muted-foreground">On that day the project&apos;s admins get a reminder.</p>
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor={`g-${p.id}`}>Tags</Label>
            <datalist id={`tl-${p.id}`}>
              {p.tagChoices.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <TagsInput id={`g-${p.id}`} list={`tl-${p.id}`} tags={d.tags} readOnly={!editable} onChange={(tags) => p.onPatch({ tags })} />
          </div>
          {editable && (
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor={`gen-${p.id}`}>Generate a random value</Label>
              <div className="flex flex-wrap items-center gap-2">
                <select aria-label="Length" id={`gen-${p.id}`} className={cn(SELECT, "w-24")} value={len} onChange={(e) => setLen(Number(e.target.value))}>
                  {[16, 24, 32, 48, 64, 128].map((n) => (
                    <option key={n} value={n}>{n} chars</option>
                  ))}
                </select>
                <select aria-label="Characters" className={cn(SELECT, "w-auto")} value={set} onChange={(e) => setSet(e.target.value as CharSet)}>
                  <option value="alnum">Letters and numbers</option>
                  <option value="hex">Hex</option>
                  <option value="symbols">With symbols</option>
                </select>
                <Button variant="outline" onClick={() => p.onPatch({ value: generateValue(len, set) })}>
                  Generate
                </Button>
              </div>
            </div>
          )}
          {shown && (shown.resolved !== null || shown.problems.length > 0) && (
            <div className="grid gap-1 sm:col-span-2">
              <p className="text-sm font-medium">Resolved preview</p>
              {shown.resolved !== null && (
                <pre className="max-h-40 overflow-auto rounded-md border bg-muted/30 px-2.5 py-1.5 font-mono text-sm break-all whitespace-pre-wrap">{shown.resolved}</pre>
              )}
              {shown.problems.map((m) => (
                <p key={m} className="flex items-center gap-1.5 text-xs text-warning">
                  <WarningIcon className="size-3.5" />
                  {m}
                </p>
              ))}
            </div>
          )}
          {!p.isNew && base && (
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor={`o-${p.id}`}>Your own value</Label>
              <p className="text-xs text-muted-foreground">
                Only you see or export it; everyone else keeps the shared value.
                {shown?.override != null && " You have one now."}
              </p>
              <div className="flex flex-wrap gap-2">
                <Input
                  id={`o-${p.id}`}
                  value={own}
                  onChange={(e) => setOwn(e.target.value)}
                  placeholder={shown?.override != null ? "Change your override" : "Set your override"}
                  className="max-w-md font-mono"
                  autoComplete="off"
                />
                <Button
                  variant="outline"
                  disabled={!own}
                  onClick={async () => {
                    await p.onOverride(own)
                    setOwn("")
                  }}
                >
                  Save mine
                </Button>
                {base.override && (
                  <Button variant="ghost" onClick={() => p.onOverride(null)}>
                    Remove mine
                  </Button>
                )}
              </div>
            </div>
          )}
          {base && (
            <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
              <p className="mr-auto text-xs text-muted-foreground">
                Version {base.version}, changed {day.format(new Date(base.updatedAt))}
                {base.updatedBy && ` by ${base.updatedBy}`}.
              </p>
              <Button variant="outline" size="sm" onClick={p.onHistory}>
                <ClockCounterClockwiseIcon />
                History
                <span className="rounded bg-muted px-1.5 text-xs tabular-nums" aria-label={`${base.version} versions`}>{base.version}</span>
                {base.comments > 0 && <span className="text-xs text-muted-foreground">{base.comments} comment{base.comments === 1 ? "" : "s"}</span>}
              </Button>
              <Button variant="outline" size="sm" onClick={p.onShare}>
                <ShareNetworkIcon />
                Share once
              </Button>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

function draftChanges(base: SecretRow, d: Draft, shown: Shown | null) {
  const out: string[] = []
  const b = baseOf(base)
  if (d.key !== b.key) out.push("key")
  if (d.comment !== b.comment) out.push("comment")
  if (d.type !== b.type) out.push("type")
  if (d.rotationAt !== b.rotationAt) out.push("rotation")
  if (!sameTags(d.tags, b.tags)) out.push("tags")
  if (shown && d.value !== shown.value) out.push("value")
  return out
}

function CopyButton({ onCopy, label }: { onCopy: () => void; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`Copy ${label}`}
      onClick={() => {
        onCopy()
        setDone(true)
        setTimeout(() => setDone(false), 1500)
      }}
    >
      {done ? <CheckIcon /> : <CopyIcon />}
    </Button>
  )
}

function TagsInput({
  id,
  list,
  tags,
  readOnly,
  onChange,
}: {
  id: string
  list: string
  tags: string[]
  readOnly: boolean
  onChange: (t: string[]) => void
}) {
  const [text, setText] = useState("")
  const add = () => {
    const next = splitTags(text).filter((t) => !tags.includes(t))
    if (next.length) onChange([...tags, ...next].sort())
    setText("")
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((t) => (
        <span key={t} className="flex items-center gap-1 rounded-md bg-muted py-0.5 pr-1 pl-2 text-xs">
          {t}
          {!readOnly && (
            <button
              type="button"
              aria-label={`Remove tag ${t}`}
              className="rounded px-1 outline-none hover:bg-background focus-visible:ring-2 focus-visible:ring-ring/50"
              onClick={() => onChange(tags.filter((x) => x !== t))}
            >
              ×
            </button>
          )}
        </span>
      ))}
      {!readOnly && (
        <Input
          id={id}
          list={list}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault()
              add()
            }
          }}
          onBlur={add}
          placeholder="Add a tag, press Enter"
          maxLength={32}
          className="h-8 max-w-48"
        />
      )}
    </div>
  )
}
