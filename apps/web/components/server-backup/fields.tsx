"use client"

import { useEffect, useId, useState } from "react"

import { volumesOf } from "@/app/(app)/more/server-backup/actions"
import { Switch } from "@/components/registry-ui"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import type { HostView } from "@/lib/server-backup/hosts"
import { TEXTAREA } from "./format"

export type What = { paths: string; excludes: string; volumes: string[]; stopContainers: boolean; preHook: string; postHook: string }
export const emptyWhat: What = { paths: "", excludes: "", volumes: [], stopContainers: false, preHook: "", postHook: "" }

// What to back up on the server: folders, Docker volumes (listed over ssh), and commands to run around the backup.
export function WhatFields({ host, value, onChange }: { host: HostView; value: What; onChange: (v: What) => void }) {
  const id = useId()
  const set = (p: Partial<What>) => onChange({ ...value, ...p })
  // The server's own volume list, fetched when the picker shows and again on "Try again"; `got` carries the attempt it answers.
  const [got, setGot] = useState<{ n: number; vols?: string[]; error?: string } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const canVolumes = host.mode === "ssh"
  useEffect(() => {
    if (!canVolumes) return
    let live = true
    volumesOf(host.id).then(
      (r) => live && setGot({ n: attempt, ...("error" in r && r.error ? { error: r.error } : { vols: ("volumes" in r && r.volumes) || [] }) }),
      () => live && setGot({ n: attempt, error: "Couldn't list the volumes. Check your connection and try again." })
    )
    return () => {
      live = false
    }
  }, [host.id, canVolumes, attempt])
  const loading = canVolumes && got?.n !== attempt
  const vols = got?.n === attempt ? got.vols : undefined
  const volError = got?.n === attempt ? got.error : undefined
  const load = () => setAttempt((n) => n + 1)

  return (
    <div className="flex flex-col gap-6">
      {!host.isSelf && (
        <>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-paths`}>Folders</Label>
            <textarea id={`${id}-paths`} rows={4} value={value.paths} onChange={(e) => set({ paths: e.target.value })} placeholder={"/etc\n/home/me/projects"} spellCheck={false} autoComplete="off" className={TEXTAREA} />
            <p className="text-sm text-muted-foreground">One absolute path per line. Folders and files both work.</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-ex`}>Leave out (optional)</Label>
            <textarea id={`${id}-ex`} rows={2} value={value.excludes} onChange={(e) => set({ excludes: e.target.value })} placeholder={"*.log\nnode_modules"} spellCheck={false} autoComplete="off" className={TEXTAREA} />
            <p className="text-sm text-muted-foreground">One pattern per line, matched like tar&apos;s <code className="font-mono">--exclude</code>.</p>
          </div>
        </>
      )}
      {canVolumes && (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">Docker volumes</legend>
          {loading && <div aria-hidden className="h-24 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />}
          {volError && (
            <p role="alert" className="text-sm text-pretty text-muted-foreground">
              {volError}{" "}
              <button type="button" onClick={load} className="rounded-sm underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">Try again</button>
            </p>
          )}
          {vols && vols.length === 0 && <p className="text-sm text-muted-foreground">This server has no Docker volumes.</p>}
          {vols && vols.length > 0 && (
            <ul className="grid max-h-60 gap-1 overflow-y-auto rounded-lg border p-1 sm:grid-cols-2">
              {[...new Set([...vols, ...value.volumes])].sort().map((v) => (
                <li key={v}>
                  <label className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm hover:bg-accent/40 pointer-coarse:min-h-11">
                    <input type="checkbox" className="size-4 shrink-0 accent-primary" checked={value.volumes.includes(v)} onChange={(e) => set({ volumes: e.target.checked ? [...value.volumes, v] : value.volumes.filter((x) => x !== v) })} />
                    <span className="min-w-0 truncate font-mono text-xs" title={v}>{v}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <label className={cn("flex min-h-11 cursor-pointer items-center justify-between gap-4 rounded-lg border px-3 py-2.5 text-sm", !value.volumes.length && "opacity-60")}>
            <span className="grid gap-0.5">
              <span className="font-medium">Stop containers while backing up</span>
              <span className="text-muted-foreground">Containers using a chosen volume are stopped for a consistent copy, and always started again. Good for databases.</span>
            </span>
            <Switch checked={value.stopContainers} disabled={!value.volumes.length} onChange={(e) => set({ stopContainers: e.target.checked })} />
          </label>
        </fieldset>
      )}
      {!host.isSelf && (
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-pre`}>Before the backup (optional)</Label>
            <Input id={`${id}-pre`} value={value.preHook} onChange={(e) => set({ preHook: e.target.value })} placeholder="pg_dump mydb > /var/backups/mydb.sql" spellCheck={false} autoComplete="off" className="font-mono pointer-coarse:h-11" />
            <p className="text-sm text-muted-foreground">Runs on the server first. If it fails, nothing is backed up.</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-post`}>After the backup (optional)</Label>
            <Input id={`${id}-post`} value={value.postHook} onChange={(e) => set({ postHook: e.target.value })} placeholder="rm /var/backups/mydb.sql" spellCheck={false} autoComplete="off" className="font-mono pointer-coarse:h-11" />
            <p className="text-sm text-muted-foreground">Runs every time, even when the backup failed.</p>
          </div>
        </div>
      )}
    </div>
  )
}

export type Keep = { daily: number; weekly: number; monthly: number }

export function RetentionFields({ value, onChange }: { value: Keep; onChange: (v: Keep) => void }) {
  const id = useId()
  const f = (k: keyof Keep, label: string) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`${id}-${k}`}>{label}</Label>
      <Input id={`${id}-${k}`} type="number" inputMode="numeric" min={0} max={1000} value={Number.isFinite(value[k]) ? value[k] : ""} onChange={(e) => onChange({ ...value, [k]: e.target.value === "" ? NaN : Number(e.target.value) })} className="tabular-nums pointer-coarse:h-11" />
    </div>
  )
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">Keep</legend>
      <div className="grid grid-cols-3 gap-3">
        {f("daily", "Daily")}
        {f("weekly", "Weekly")}
        {f("monthly", "Monthly")}
      </div>
      <p className="text-sm text-pretty text-muted-foreground">The newest snapshot of each of the last N days, weeks and months is kept; older ones are removed and their space freed.</p>
    </fieldset>
  )
}
