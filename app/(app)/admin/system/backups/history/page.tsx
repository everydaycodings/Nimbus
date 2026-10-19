import {
  CheckCircleIcon,
  CircleDashedIcon,
  PushPinIcon,
  WarningCircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react/dist/ssr"
import { and, asc, desc, eq, type SQL } from "drizzle-orm"
import Link from "next/link"

import { AdminPage, FRAME } from "@/components/admin/setting"
import { SubmitButton } from "@/components/submit-button"
import { Badge } from "@/components/ui/badge"
import { CHECKS, CHECK_LABEL, KINDS, KIND_LABEL, type Check, type Kind, type RunStatus } from "@/lib/backup-rules"
import { isUnlocked, reauthMethod } from "@/lib/backup/reauth"
import { db } from "@/lib/db"
import { backupNotes, backupRuns, user } from "@/lib/db/schema"
import { formatBytes } from "@/lib/file-rules"
import { requireAdmin } from "@/lib/session"
import { getSettings } from "@/lib/signup"
import { cn } from "@/lib/utils"
import { addNote, reverify, setPin } from "../actions"
import { AutoRefresh, Download, Reauth } from "../backups-client"
import { BASE, StatusLabel, Tabs, duration, when } from "../parts"

export const metadata = { title: "Backup history · Admin · Nimbus" }

const STATUSES: RunStatus[] = ["ok", "warning", "failed", "running", "skipped"]

const TRIGGER = { schedule: "On schedule", manual: "By hand", retry: "Retry", reverify: "Re-verify" }

function Filter({ label, value, options, param, q }: { label: string; value?: string; options: { v: string; l: string }[]; param: string; q: Record<string, string | undefined> }) {
  const href = (v?: string) => {
    const p = new URLSearchParams(Object.entries({ ...q, [param]: v, run: undefined }).filter((e): e is [string, string] => Boolean(e[1])))
    return `?${p}`
  }
  return (
    <nav aria-label={label} className="flex rounded-md border bg-input/30 p-0.5">
      {[{ v: "", l: "All" }, ...options].map((o) => (
        <Link
          key={o.v}
          href={href(o.v || undefined)}
          scroll={false}
          aria-current={(value ?? "") === o.v ? "page" : undefined}
          className="rounded-[5px] px-2.5 py-1 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-[current=page]:bg-accent aria-[current=page]:text-foreground"
        >
          {o.l}
        </Link>
      ))}
    </nav>
  )
}

const STEP_ICON = {
  ok: <CheckCircleIcon weight="fill" className="size-4 text-success" />,
  warn: <WarningCircleIcon weight="fill" className="size-4 text-warning" />,
  fail: <XCircleIcon weight="fill" className="size-4 text-destructive" />,
  none: <CircleDashedIcon className="size-4 text-muted-foreground" />,
}

// Warnings don't fail a run; these checks only ever warn.
const WARN_ONLY = new Set(["integrity", "size"])

// A re-verify starts from the stored file and stops at the comparison.
const REVERIFY = ["file", "restore", "schema", "integrity"] as const

function ProofChain({ kind, reverify, checks, status }: { kind: Kind; reverify: boolean; checks: Partial<Record<string, Check>>; status: RunStatus }) {
  return (
    <ol className="flex flex-col">
      {(reverify ? REVERIFY : CHECKS[kind]).map((name, i, all) => {
        const c = checks[name]
        const state = !c ? "none" : c.ok ? "ok" : WARN_ONLY.has(name) ? "warn" : "fail"
        return (
          <li key={name} className="relative flex gap-3 pb-4 last:pb-0">
            {i < all.length - 1 && <span aria-hidden className="absolute top-5 bottom-0 left-[7.5px] w-px bg-border" />}
            <span className="relative mt-0.5 shrink-0 bg-card">{STEP_ICON[state]}</span>
            <div className="grid min-w-0 gap-0.5 text-sm">
              <span className={cn("font-medium", state === "none" && "text-muted-foreground")}>
                {CHECK_LABEL[name]}
                <span className="sr-only">: {state === "none" ? (status === "running" ? "waiting" : "didn't run") : state === "ok" ? "passed" : state === "warn" ? "warning" : "failed"}</span>
              </span>
              {c?.detail && <span className="text-pretty text-muted-foreground">{c.detail}</span>}
              {!c && status !== "running" && <span className="text-muted-foreground">Didn&apos;t run.</span>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

async function Detail({ id }: { id: string }) {
  const me = await requireAdmin()
  const [run] = await db
    .select({ r: backupRuns, actor: user.name, email: user.email })
    .from(backupRuns)
    .leftJoin(user, eq(user.id, backupRuns.actorId))
    .where(eq(backupRuns.id, id))
  if (!run) return <p className="text-sm text-muted-foreground">That run doesn&apos;t exist.</p>
  const r = run.r
  const [notes, source, unlocked, method, s] = await Promise.all([
    db
      .select({ n: backupNotes, who: user.name, email: user.email })
      .from(backupNotes)
      .leftJoin(user, eq(user.id, backupNotes.userId))
      .where(eq(backupNotes.runId, id))
      .orderBy(asc(backupNotes.createdAt)),
    r.sourceRunId ? db.select().from(backupRuns).where(eq(backupRuns.id, r.sourceRunId)).then((x) => x[0]) : null,
    isUnlocked(),
    reauthMethod(me),
    getSettings(),
  ])
  const stored = r.kind === "db" && r.trigger !== "reverify" && r.s3Key && !r.deletedAt && r.status !== "failed"
  const facts: [string, React.ReactNode][] = [
    ["Started", when(r.startedAt, s.backupTz)],
    ["Took", duration(r.startedAt, r.finishedAt) ?? "Still running"],
    ["Started by", r.trigger === "schedule" ? "The schedule" : r.trigger === "retry" ? `Retry, attempt ${r.attempt}` : (run.actor || run.email || "Someone")],
    ...(source ? ([["Checks", <Link key="s" href={`?run=${source.id}`} className="underline underline-offset-4">the backup from {when(source.startedAt, s.backupTz)}</Link>]] as [string, React.ReactNode][]) : []),
    ...(r.kind === "db" && r.dbSizeBytes ? ([["Database", formatBytes(r.dbSizeBytes)]] as [string, string][]) : []),
    ...(r.sizeBytes !== null ? ([[r.kind === "db" ? "Dump" : "Copied", formatBytes(r.sizeBytes)]] as [string, string][]) : []),
    ...(r.kind === "files" && r.stats.objects !== undefined ? ([["Mirror", `${r.stats.objects} files · ${formatBytes(r.stats.totalBytes ?? 0)}`]] as [string, string][]) : []),
    ...(r.s3Key ? ([["File", <span key="k" className="font-mono text-xs break-all">{r.s3Key}{r.deletedAt && <span className="ml-2 font-sans text-muted-foreground">deleted by retention</span>}</span>]] as [string, React.ReactNode][]) : []),
    ...(r.sha256 ? ([["SHA-256", <span key="h" className="font-mono text-xs break-all">{r.sha256}</span>]] as [string, React.ReactNode][]) : []),
  ]

  return (
    <section aria-label="Run detail" className={cn(FRAME, "flex flex-col divide-y")}>
      <AutoRefresh running={r.status === "running"} />
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <StatusLabel status={r.status} className="text-base font-semibold" />
          <span className="text-base font-semibold">{KIND_LABEL[r.kind]} {r.trigger === "reverify" ? "re-verify" : "backup"}</span>
          {r.pinned && (
            <Badge variant="secondary">
              <PushPinIcon weight="fill" /> Pinned
            </Badge>
          )}
        </div>
        {stored && (
          <div className="flex flex-wrap items-center gap-2">
            <form action={setPin.bind(null, r.id, !r.pinned)}>
              <SubmitButton variant="ghost" size="sm">{r.pinned ? "Unpin" : "Pin"}</SubmitButton>
            </form>
            <form action={reverify.bind(null, r.id)}>
              <SubmitButton variant="outline" size="sm">Re-verify</SubmitButton>
            </form>
            {unlocked && <Download runId={r.id} />}
          </div>
        )}
      </header>

      {r.error && (
        <p role="alert" className="flex gap-2 px-5 py-3 text-sm text-pretty">
          <XCircleIcon weight="fill" className="mt-0.5 size-4 shrink-0 text-destructive" />
          {r.error}
        </p>
      )}

      <div className="grid gap-8 px-5 py-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">What it proved</h3>
          <ProofChain kind={r.kind} reverify={r.trigger === "reverify"} checks={r.checks} status={r.status} />
        </div>
        <dl className="grid content-start gap-x-4 gap-y-2 text-sm sm:grid-cols-[7rem_minmax(0,1fr)]">
          {facts.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="min-w-0 tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      {r.diffs.length > 0 && (
        <div className="flex flex-col gap-3 px-5 py-5">
          <h3 className="text-sm font-semibold">Differences between the live database and the copy</h3>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="px-3 py-2 font-medium">What</th>
                  <th className="px-3 py-2 font-medium">Live</th>
                  <th className="px-3 py-2 font-medium">Restored copy</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {r.diffs.slice(0, 100).map((d) => (
                  <tr key={`${d.kind}:${d.name}`}>
                    <td className="px-3 py-2 font-mono text-xs">{d.name}</td>
                    <td className="px-3 py-2 tabular-nums">{d.live ?? <span className="text-muted-foreground">missing</span>}</td>
                    <td className="px-3 py-2 tabular-nums">{d.restored ?? <span className="text-muted-foreground">missing</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {stored && !unlocked && (
        <div className="flex flex-col gap-3 px-5 py-5">
          <div className="grid gap-1">
            <h3 className="text-sm font-semibold">Download this backup</h3>
            <p className="text-sm text-pretty text-muted-foreground">
              A backup holds every account and setting, so confirm it&apos;s you first. Downloads stay unlocked for 10
              minutes in this browser. The file is encrypted: restore it with{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">npm run backup:restore</code>.
            </p>
          </div>
          <Reauth method={method} email={me.email} />
        </div>
      )}

      <div className="flex flex-col gap-3 px-5 py-5">
        <h3 className="text-sm font-semibold">Notes</h3>
        {notes.length > 0 && (
          <ol className="flex flex-col gap-2">
            {notes.map(({ n, who, email }) => (
              <li key={n.id} className="text-sm">
                <span className="font-medium">{who || email || "Someone"}</span>{" "}
                <span className="text-muted-foreground">
                  {n.kind === "pin" ? "pinned it" : n.kind === "unpin" ? "unpinned it" : ""} · {when(n.createdAt, s.backupTz)}
                </span>
                {n.body && <p className="mt-0.5 text-pretty whitespace-pre-wrap">{n.body}</p>}
              </li>
            ))}
          </ol>
        )}
        <form action={addNote.bind(null, r.id)} className="flex flex-wrap items-end gap-2">
          <label htmlFor="note" className="sr-only">Add a note</label>
          <textarea
            id="note"
            name="note"
            rows={1}
            maxLength={2000}
            required
            placeholder="Add a note, e.g. Restored to staging and checked"
            className="min-h-9 min-w-0 flex-1 resize-y rounded-md border border-input bg-input/30 px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          <SubmitButton variant="outline">Add note</SubmitButton>
        </form>
        <p className="text-xs text-muted-foreground">Notes can&apos;t be edited or deleted, so they stay a true record.</p>
      </div>
    </section>
  )
}

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ kind?: string; status?: string; run?: string }> }) {
  const q = await searchParams
  const kind = KINDS.includes(q.kind as Kind) ? (q.kind as Kind) : undefined
  const status = STATUSES.includes(q.status as RunStatus) ? (q.status as RunStatus) : undefined
  const where: SQL[] = []
  if (kind) where.push(eq(backupRuns.kind, kind))
  if (status) where.push(eq(backupRuns.status, status))
  const [runs, s] = await Promise.all([
    db.select().from(backupRuns).where(and(...where)).orderBy(desc(backupRuns.startedAt)).limit(200),
    getSettings(),
  ])
  const uuid = /^[0-9a-f-]{36}$/.test(q.run ?? "") ? q.run : undefined

  return (
    <AdminPage wide title="Backups" description="Every backup and re-verify, what each one proved, and the notes on it.">
      <Tabs current={`${BASE}/history`} />
      {uuid && <Detail id={uuid} />}
      <section aria-label="Runs" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Filter label="Kind" param="kind" value={kind} q={q} options={KINDS.map((k) => ({ v: k, l: KIND_LABEL[k] }))} />
          <Filter label="Status" param="status" value={status} q={q} options={STATUSES.filter((x) => x !== "running").map((x) => ({ v: x, l: x === "ok" ? "Verified" : x[0].toUpperCase() + x.slice(1) }))} />
        </div>
        <div className={cn(FRAME, "overflow-x-auto")}>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">What</th>
                <th className="px-4 py-2.5 font-medium">Started</th>
                <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Took</th>
                <th className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">Size</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {runs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    {kind || status ? "No runs match." : "No backups yet."}
                  </td>
                </tr>
              )}
              {runs.map((r) => (
                <tr key={r.id} aria-current={r.id === uuid ? "true" : undefined} className="relative hover:bg-input/20 aria-[current=true]:bg-accent/60">
                  <td className="px-4 py-2.5">
                    <Link href={`?${new URLSearchParams({ ...(kind && { kind }), ...(status && { status }), run: r.id })}`} scroll={false} className="outline-none after:absolute after:inset-0 focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50">
                      <StatusLabel status={r.status} />
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    {KIND_LABEL[r.kind]}
                    <span className="text-muted-foreground"> · {TRIGGER[r.trigger]}</span>
                    {r.pinned && <PushPinIcon weight="fill" aria-label="Pinned" className="ml-1.5 inline size-3.5 text-muted-foreground" />}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap tabular-nums">{when(r.startedAt, s.backupTz)}</td>
                  <td className="hidden px-4 py-2.5 whitespace-nowrap text-muted-foreground tabular-nums sm:table-cell">{duration(r.startedAt, r.finishedAt) ?? "…"}</td>
                  <td className="hidden px-4 py-2.5 text-right whitespace-nowrap text-muted-foreground tabular-nums sm:table-cell">
                    {r.sizeBytes !== null ? formatBytes(r.sizeBytes) : "—"}
                    {r.deletedAt && <span className="sr-only"> (deleted)</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </AdminPage>
  )
}
