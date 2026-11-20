"use client"

import { Menu } from "@base-ui/react/menu"
import { CheckCircleIcon, PencilSimpleIcon, PlusIcon, ShieldCheckIcon, TrashIcon, WarningCircleIcon } from "@phosphor-icons/react"
import { useId, useState, useTransition } from "react"

import { checkConnection, deleteConnection, renameConnection } from "@/app/(app)/more/import/actions"
import { Empty } from "@/components/empty-state"
import { MENU_ITEM } from "@/components/overlay-styles"
import { LIST, RowMenu, TOUCH } from "@/components/registry-ui"
import { SubmitButton } from "@/components/submit-button"
import { useNotice } from "@/components/toaster"
import { FormError } from "@/components/two-factor"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { ConnView } from "@/lib/import/connections"
import { PROVIDERS } from "@/lib/import/rules"
import { cn } from "@/lib/utils"
import { AddConnection, type Ready } from "./add-connection"
import { ago } from "./format"
import { ProviderIcon } from "./providers"

type Mode = { id: string; kind: "rename" | "delete" }

// The member's saved sources: add, test again, rename, delete (blocked while an import uses one).
export function ConnectionsManager({ connections, oauth, adding: startAdding }: { connections: ConnView[]; oauth: Ready; adding?: boolean }) {
  const setNotice = useNotice()
  const [mode, setMode] = useState<Mode | null>(null)
  const [adding, setAdding] = useState(Boolean(startAdding))
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const [, start] = useTransition()
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="mr-auto grid gap-0.5">
          <h2 className="text-base font-semibold">Connections</h2>
          <p className="text-sm text-pretty text-muted-foreground">The accounts and servers Nimbus can read from. Access is read-only; nothing is changed at the source.</p>
        </div>
        {!adding && connections.length > 0 && (
          <Button variant="outline" className={TOUCH} onClick={() => setAdding(true)}>
            <PlusIcon />
            Add a connection
          </Button>
        )}
      </div>
      {adding && <AddConnection oauth={oauth} onAdded={() => (setAdding(false), setNotice({ text: "Connection saved." }))} onCancel={() => setAdding(false)} />}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {connections.length === 0 ? (
        !adding && (
          <Empty icon={PlusIcon} title="No connections yet">
            <p>Connect Google Drive, Dropbox, OneDrive, an S3 bucket, a WebDAV share or an SFTP server to bring its files over.</p>
            <Button className={TOUCH} onClick={() => setAdding(true)}>Add a connection</Button>
          </Empty>
        )
      ) : (
        <ul className={LIST}>
          {connections.map((c) => (
            <li key={c.id} className="grid gap-3 px-3 py-3 sm:px-4">
              <div className="flex items-center gap-3">
                <ProviderIcon provider={c.provider} />
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate text-sm font-medium" title={c.label}>{c.label}</span>
                    <Badge variant="outline">{PROVIDERS[c.provider].label}</Badge>
                    {c.error ? (
                      <Badge variant="outline" className="text-destructive"><WarningCircleIcon aria-hidden />Needs attention</Badge>
                    ) : (
                      <Badge variant="outline"><CheckCircleIcon aria-hidden className="text-brand" />Works</Badge>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground" title={c.account ?? undefined} suppressHydrationWarning>
                    {c.account ? `${c.account}${c.root ? ` / ${c.root}` : ""} · ` : ""}checked {ago(c.lastChecked, "never")} · {c.jobs} import{c.jobs === 1 ? "" : "s"}
                  </p>
                  {c.error && <p className="text-xs text-pretty text-destructive">{c.error}</p>}
                </div>
                <RowMenu label={`Actions for ${c.label}`}>
                  <Menu.Item
                    className={MENU_ITEM}
                    onClick={() =>
                      start(async () => {
                        setBusy(c.id)
                        setError(undefined)
                        const r = await checkConnection(c.id)
                        setBusy(undefined)
                        if ("error" in r && r.error) setError(`${c.label}: ${r.error}`)
                        else setNotice({ text: `${c.label} works.` })
                      })
                    }
                  >
                    <ShieldCheckIcon />
                    {busy === c.id ? "Checking…" : "Check now"}
                  </Menu.Item>
                  <Menu.Item className={MENU_ITEM} onClick={() => setMode({ id: c.id, kind: "rename" })}>
                    <PencilSimpleIcon />
                    Rename
                  </Menu.Item>
                  <Menu.Item className={cn(MENU_ITEM, "text-destructive")} onClick={() => setMode({ id: c.id, kind: "delete" })}>
                    <TrashIcon className="text-destructive!" />
                    Delete
                  </Menu.Item>
                </RowMenu>
              </div>
              {mode?.id === c.id && <Edit c={c} kind={mode.kind} onClose={() => setMode(null)} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Edit({ c, kind, onClose }: { c: ConnView; kind: Mode["kind"]; onClose: () => void }) {
  const id = useId()
  const setNotice = useNotice()
  const [v, setV] = useState(c.label)
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()
  return (
    <form
      className="grid gap-3 rounded-lg border bg-background/40 p-3"
      onSubmit={(e) => {
        e.preventDefault()
        setError(undefined)
        start(async () => {
          const r = kind === "rename" ? await renameConnection(c.id, v) : await deleteConnection(c.id)
          if (r.error) return setError(r.error)
          setNotice({ text: kind === "rename" ? "Renamed." : `Deleted “${c.label}”.` })
          onClose()
        })
      }}
    >
      {kind === "delete" ? (
        <p className="text-sm text-pretty">Delete “{c.label}”? Nimbus forgets the login. Files already imported stay in Files. {c.jobs ? "Imports that use it must be deleted first." : ""}</p>
      ) : (
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-v`}>Name</Label>
          <Input id={`${id}-v`} value={v} maxLength={60} onChange={(e) => setV(e.target.value)} autoFocus autoComplete="off" className="pointer-coarse:h-11" />
        </div>
      )}
      <FormError>{error}</FormError>
      <div className="flex gap-2">
        <SubmitButton pending={pending} disabled={kind === "rename" && !v.trim()} variant={kind === "delete" ? "destructive" : "default"} className={TOUCH}>
          {kind === "rename" ? "Save" : "Delete"}
        </SubmitButton>
        <Button type="button" variant="ghost" className={TOUCH} disabled={pending} onClick={onClose}>Cancel</Button>
      </div>
    </form>
  )
}
