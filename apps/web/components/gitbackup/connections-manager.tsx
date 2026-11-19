"use client"

import { Menu } from "@base-ui/react/menu"
import { KeyIcon, PencilSimpleIcon, ShieldCheckIcon, TrashIcon } from "@phosphor-icons/react"
import { useEffect, useId, useState, useTransition } from "react"

import { checkConnection, deleteConnection, renameConnection, replaceToken } from "@/app/(app)/more/github-backup/actions"
import { Empty } from "@/components/empty-state"
import { MENU_ITEM } from "@/components/overlay-styles"
import { ExpiryBadge } from "@/components/registry-connections"
import { DAY, LIST, RowMenu, TOUCH } from "@/components/registry-ui"
import { SubmitButton } from "@/components/submit-button"
import { useNotice } from "@/components/toaster"
import { FormError } from "@/components/two-factor"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { ConnView, Saved } from "@/lib/gitbackup/connections"
import { hostBase } from "@/lib/gitbackup/refs"
import { PermChecklist } from "./perm-checklist"
import { PROVIDERS, ProviderIcon } from "./providers"

type Mode = { id: string; kind: "rename" | "replace" | "delete" | "check" }

// The member's saved tokens: rename, replace the token, delete (blocked while a job uses it).
export function ConnectionsManager({ connections }: { connections: ConnView[] }) {
  const [mode, setMode] = useState<Mode | null>(null)
  if (connections.length === 0) return <Empty icon={KeyIcon} title="No saved tokens">Tokens you add while setting up a job appear here.</Empty>
  return (
    <ul className={LIST}>
      {connections.map((c) => (
        <li key={c.id} className="grid gap-3 px-3 py-3 sm:px-4">
          <div className="flex items-center gap-3">
            <ProviderIcon provider={c.provider} />
            <div className="grid min-w-0 flex-1 gap-0.5">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="truncate text-sm font-medium" title={c.name}>{c.name}</span>
                <Badge variant="outline">{PROVIDERS[c.provider].label}</Badge>
                <Badge variant="outline">{c.via === "oauth" ? "OAuth" : "Token"}</Badge>
                <ExpiryBadge at={c.expiresAt} />
              </div>
              <p className="truncate text-xs text-muted-foreground" title={c.account ?? undefined}>
                {c.account ?? "Unknown account"}
                {c.host ? ` · ${c.host}` : ""} · ends in <span className="font-mono">{c.last4}</span>
                {c.expiresAt ? ` · expires ${DAY.format(new Date(c.expiresAt))}` : ""} · {c.jobs} job{c.jobs === 1 ? "" : "s"}
              </p>
            </div>
            <RowMenu label={`Actions for ${c.name}`}>
              <Menu.Item className={MENU_ITEM} onClick={() => setMode({ id: c.id, kind: "rename" })}>
                <PencilSimpleIcon />
                Rename
              </Menu.Item>
              <Menu.Item className={MENU_ITEM} onClick={() => setMode({ id: c.id, kind: "check" })}>
                <ShieldCheckIcon />
                Check permissions
              </Menu.Item>
              {c.via === "pat" && (
                <Menu.Item className={MENU_ITEM} onClick={() => setMode({ id: c.id, kind: "replace" })}>
                  <KeyIcon />
                  Replace token
                </Menu.Item>
              )}
              <Menu.Item className={`${MENU_ITEM} text-destructive`} onClick={() => setMode({ id: c.id, kind: "delete" })}>
                <TrashIcon className="text-destructive!" />
                Delete
              </Menu.Item>
            </RowMenu>
          </div>
          {mode?.id === c.id && (mode.kind === "check" ? <Check c={c} onClose={() => setMode(null)} /> : <Edit c={c} kind={mode.kind} onClose={() => setMode(null)} />)}
        </li>
      ))}
    </ul>
  )
}

// Checks a saved token against its host now and lists what it can and can't do.
function Check({ c, onClose }: { c: ConnView; onClose: () => void }) {
  const [r, setR] = useState<Saved>()
  useEffect(() => {
    let live = true
    checkConnection(c.id).then((x) => live && setR(x))
    return () => {
      live = false
    }
  }, [c.id])
  return (
    <div className="grid gap-3 rounded-lg border bg-background/40 p-3">
      {!r ? (
        <p role="status" className="text-sm text-muted-foreground">Checking the permissions of “{c.name}”…</p>
      ) : r.checks ? (
        <PermChecklist provider={c.provider} checks={r.checks} fix={r.fix} note={r.note} link={PROVIDERS[c.provider].link(c.host ? hostBase(c.host) : "")} />
      ) : (
        <FormError>{r.error}</FormError>
      )}
      <div>
        <Button type="button" variant="ghost" className={TOUCH} onClick={onClose}>Close</Button>
      </div>
    </div>
  )
}

function Edit({ c, kind, onClose }: { c: ConnView; kind: Mode["kind"]; onClose: () => void }) {
  const id = useId()
  const setNotice = useNotice()
  const [v, setV] = useState(kind === "rename" ? c.name : "")
  const [error, setError] = useState<string>()
  const [checks, setChecks] = useState<Saved>()
  const [pending, start] = useTransition()
  const run = () =>
    start(async () => {
      setError(undefined)
      setChecks(undefined)
      const r = kind === "rename" ? await renameConnection(c.id, v) : kind === "replace" ? await replaceToken(c.id, v) : await deleteConnection(c.id)
      if ("checks" in r && r.checks) setChecks(r as Saved)
      if (r.error) return setError(r.error)
      // The form closes on success, so a missing optional permission goes in the toast.
      const lacks = ((r as Saved).checks ?? []).filter((p) => !p.required && p.ok === false).map((p) => p.name)
      const warn = lacks.length ? ` It lacks ${lacks.join(", ")}, so backups on push won't work.` : ""
      setNotice({ text: kind === "rename" ? "Renamed." : kind === "replace" ? `Replaced the token of “${c.name}”.${warn}` : `Deleted “${c.name}”.` })
      onClose()
    })
  return (
    <form
      className="grid gap-3 rounded-lg border bg-background/40 p-3"
      onSubmit={(e) => {
        e.preventDefault()
        run()
      }}
    >
      {kind === "delete" ? (
        <p className="text-sm text-pretty">
          Delete “{c.name}”? The token is removed from Nimbus. {c.jobs ? "Jobs that use it must be deleted or moved first." : "Nothing uses it."}
        </p>
      ) : (
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-v`}>{kind === "rename" ? "Name" : "New token"}</Label>
          <Input id={`${id}-v`} type={kind === "rename" ? "text" : "password"} value={v} maxLength={kind === "rename" ? 60 : 1000} onChange={(e) => setV(e.target.value)} autoFocus autoComplete="off" spellCheck={false} className={kind === "rename" ? "pointer-coarse:h-11" : "font-mono pointer-coarse:h-11"} />
          {kind === "replace" && <p className="text-sm text-muted-foreground">It must belong to {c.account ?? "the same account"}. Jobs pick it up straight away.</p>}
        </div>
      )}
      <FormError>{error}</FormError>
      {checks?.checks && <PermChecklist provider={c.provider} checks={checks.checks} fix={checks.fix} note={checks.note} link={PROVIDERS[c.provider].link(c.host ? hostBase(c.host) : "")} />}
      <div className="flex gap-2">
        <SubmitButton pending={pending} disabled={kind !== "delete" && !v.trim()} variant={kind === "delete" ? "destructive" : "default"} className={TOUCH}>
          {kind === "rename" ? "Save" : kind === "replace" ? "Replace" : "Delete"}
        </SubmitButton>
        <Button type="button" variant="ghost" className={TOUCH} disabled={pending} onClick={onClose}>Cancel</Button>
      </div>
    </form>
  )
}
