"use client"

import { ArrowCounterClockwiseIcon, FolderSimpleIcon, TrashIcon } from "@phosphor-icons/react"
import { useCallback, useEffect, useState } from "react"

import { api, errorText } from "@/components/secrets/client"
import type { Detail } from "@/components/secrets/project-view"
import { Confirm } from "@/components/secrets/ui"
import { CHECKBOX } from "@/components/secrets/ui"
import { useNotice } from "@/components/toaster"
import { Button } from "@/components/ui/button"

type Item = { id: string; key: string; env: string; folder: string; deletedAt: string; deletedBy: string | null }
const when = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" })

export function TrashView({
  detail,
  canWrite,
  onChanged,
}: {
  detail: Detail
  canWrite: boolean
  onChanged: () => void
}) {
  const notify = useNotice()
  const [items, setItems] = useState<Item[] | null>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [purge, setPurge] = useState(false)

  const load = useCallback(() => {
    api<{ items: Item[] }>(`/projects/${detail.id}/trash`)
      .then((r) => (setItems(r.items), setSel(new Set())))
      .catch((e) => setError(errorText(e)))
  }, [detail.id])
  useEffect(load, [load])

  async function restore() {
    try {
      const r = await api<{ restored: string[]; skipped: string[] }>(`/projects/${detail.id}/trash`, "POST", {
        action: "restore",
        ids: [...sel],
      })
      notify({
        text: r.skipped.length
          ? `Restored ${r.restored.length}. ${r.skipped.join(", ")} not restored: a secret with that name is already there.`
          : `Restored ${r.restored.length} secret${r.restored.length === 1 ? "" : "s"}.`,
        error: r.restored.length === 0,
      })
      load()
      onChanged()
    } catch (e) {
      notify({ text: errorText(e), error: true })
    }
  }

  if (error) return <p role="alert" className="text-sm text-destructive">{error}</p>
  if (!items) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (!items.length)
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-14 text-center">
        <TrashIcon weight="light" className="size-10 text-muted-foreground" />
        <p className="font-medium">Trash is empty</p>
        <p className="max-w-sm text-sm text-pretty text-muted-foreground">
          Deleted secrets wait here until you restore them or delete them for good.
        </p>
      </div>
    )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className={CHECKBOX}
            checked={sel.size === items.length}
            onChange={(e) => setSel(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())}
          />
          Select all
        </label>
        {canWrite && (
          <div className="ml-auto flex gap-2">
            <Button variant="outline" disabled={!sel.size} onClick={restore}>
              <ArrowCounterClockwiseIcon />
              Restore
            </Button>
            <Button variant="destructive" disabled={!sel.size} onClick={() => setPurge(true)}>
              <TrashIcon />
              Delete forever
            </Button>
          </div>
        )}
      </div>
      <ul className="flex flex-col divide-y rounded-xl border">
        {items.map((i) => (
          <li key={i.id} className="flex items-center gap-3 px-4 py-2.5">
            <input
              type="checkbox"
              className={CHECKBOX}
              aria-label={`Select ${i.key}`}
              checked={sel.has(i.id)}
              onChange={(e) =>
                setSel((s) => {
                  const n = new Set(s)
                  if (e.target.checked) n.add(i.id)
                  else n.delete(i.id)
                  return n
                })
              }
            />
            <div className="grid min-w-0 flex-1 gap-0.5">
              <span className="truncate font-mono text-sm">{i.key}</span>
              <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                {i.env}
                {i.folder && (
                  <span className="flex items-center gap-1">
                    <FolderSimpleIcon className="size-3" />
                    {i.folder}
                  </span>
                )}
                <span>
                  deleted {when.format(new Date(i.deletedAt))}
                  {i.deletedBy && ` by ${i.deletedBy}`}
                </span>
              </span>
            </div>
          </li>
        ))}
      </ul>
      {purge && (
        <Confirm
          title={`Delete ${sel.size} secret${sel.size === 1 ? "" : "s"} forever?`}
          description="Their values and history are erased. This can't be undone."
          action="Delete forever"
          danger
          run={async () => {
            await api(`/projects/${detail.id}/trash`, "POST", { action: "purge", ids: [...sel] })
            load()
            onChanged()
          }}
          onClose={() => setPurge(false)}
        />
      )}
    </div>
  )
}
