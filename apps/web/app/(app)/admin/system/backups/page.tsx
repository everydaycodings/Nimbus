import {
  ArrowRightIcon,
  CheckCircleIcon,
  ClockIcon,
  PauseCircleIcon,
  WarningCircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react/dist/ssr"
import { and, desc, eq, inArray, ne } from "drizzle-orm"
import Link from "next/link"

import { AdminPage, FRAME, Section } from "@/components/admin/setting"
import { SubmitButton } from "@/components/submit-button"
import { Badge } from "@/components/ui/badge"
import {
  KIND_LABEL,
  PROVIDER_LABEL,
  monthlyCents,
  type Kind,
} from "@/lib/backup-rules"
import { backupStatus } from "@/lib/backup/status"
import { db } from "@/lib/db"
import { backupRuns } from "@/lib/db/schema"
import { formatBytes } from "@/lib/file-rules"
import { ago } from "@/lib/health-rules"
import { getSettings } from "@/lib/signup"
import { cn } from "@/lib/utils"
import { setPaused } from "./actions"
import {
  AutoRefresh,
  BackupNow,
  Trend,
  type TrendPoint,
} from "./backups-client"
import {
  BASE,
  SetupNotes,
  StatusLabel,
  Tabs,
  duration,
  until,
  when,
} from "./parts"

export const metadata = { title: "Backups · Admin · Nimbus" }

const STEP: Record<string, string> = {
  snapshot: "Taking a snapshot of the database",
  dump: "Dumping and encrypting",
  restore: "Restoring into a throwaway Postgres",
  compare: "Comparing the copy with the live database",
  upload: "Uploading",
  file: "Reading the upload back",
  retention: "Removing old backups",
  source: "Finding new files",
  copy: "Copying new files",
  prune: "Clearing purged files",
  sample: "Reading a sample back",
}

async function history(kind: Kind) {
  return db
    .select()
    .from(backupRuns)
    .where(
      and(
        eq(backupRuns.kind, kind),
        ne(backupRuns.trigger, "reverify"),
        inArray(backupRuns.status, ["ok", "warning"])
      )
    )
    .orderBy(desc(backupRuns.startedAt))
    .limit(30)
}

const secs = (r: { startedAt: Date; finishedAt: Date | null }) =>
  r.finishedAt ? (r.finishedAt.getTime() - r.startedAt.getTime()) / 1000 : null
const fmtSecs = (s: number) =>
  s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`

export default async function BackupsPage() {
  const s = await getSettings()
  const day = (d: Date) =>
    d.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      timeZone: s.backupTz,
    })
  const points = (
    rows: Awaited<ReturnType<typeof history>>,
    pick: (r: (typeof rows)[number]) => number | null,
    label: (n: number) => string
  ): TrendPoint[] =>
    rows.toReversed().flatMap((r) => {
      const v = pick(r)
      return v === null
        ? []
        : [{ day: day(r.startedAt), value: v, label: label(v) }]
    })

  const [b, dbRuns, fileRuns, recent] = await Promise.all([
    backupStatus(s),
    history("db"),
    history("files"),
    db.select().from(backupRuns).orderBy(desc(backupRuns.startedAt)).limit(6),
  ])
  const { now } = b
  const on = b.kinds.filter((k) => k.schedule.enabled)
  const ready = Boolean(b.dest && b.worker)

  const running = b.kinds.find((k) => k.last?.status === "running")
  const failed = on.find((k) => k.last?.status === "failed")
  const stale = on.find((k) => k.stale)
  const warned = on.find((k) => k.last?.status === "warning")
  const name = (k: Kind) => KIND_LABEL[k].toLowerCase()
  const [Icon, tone, headline] = !b.dest
    ? [ClockIcon, "text-muted-foreground", "Backups aren't set up yet"]
    : running
      ? [ClockIcon, "text-brand", `Backing up the ${name(running.kind)}`]
      : failed
        ? [
            XCircleIcon,
            "text-destructive",
            `The last ${name(failed.kind)} backup failed`,
          ]
        : stale
          ? [
              WarningCircleIcon,
              "text-warning",
              `No good ${name(stale.kind)} backup in over ${2 * stale.schedule.intervalHours} h`,
            ]
          : warned
            ? [
                WarningCircleIcon,
                "text-warning",
                `The last ${name(warned.kind)} backup has a warning`,
              ]
            : s.backupPaused
              ? [
                  PauseCircleIcon,
                  "text-muted-foreground",
                  "Scheduled backups are paused",
                ]
              : !on.length
                ? [
                    ClockIcon,
                    "text-muted-foreground",
                    "Scheduled backups are off",
                  ]
                : [CheckCircleIcon, "text-success", "Backups are working"]
  const lastGood = b.kinds
    .flatMap((k) => (k.lastGood ? [k.lastGood.startedAt] : []))
    .sort((x, y) => y.getTime() - x.getTime())[0]

  const total = b.stored.dumps.bytes + b.stored.mirror.bytes
  const cents = b.dest ? monthlyCents(b.dest.provider, total) : null

  return (
    <AdminPage
      wide
      title="Backups"
      description="Copies of the database and every file, proven to restore before they're kept, in storage you choose."
    >
      <Tabs current={BASE} />
      <AutoRefresh running={Boolean(running)} />

      <section aria-label="Status" className="flex flex-col gap-3">
        <div
          className={cn(
            FRAME,
            "flex flex-wrap items-center gap-x-6 gap-y-4 px-5 py-4"
          )}
        >
          <div className="flex min-w-[min(100%,18rem)] flex-1 items-center gap-3">
            <Icon weight="fill" className={cn("size-7 shrink-0", tone)} />
            <div className="grid min-w-0 gap-0.5">
              <p className="text-base font-semibold text-balance">{headline}</p>
              <p className="text-sm text-muted-foreground">
                {running?.last?.step
                  ? `${STEP[running.last.step] ?? running.last.step}…`
                  : failed?.last?.error
                    ? failed.last.error
                    : lastGood
                      ? `Last good backup ${ago(lastGood.toISOString(), now)}`
                      : "Nothing backed up yet"}
              </p>
            </div>
          </div>
          {on.length > 0 && (
            <form action={setPaused.bind(null, !s.backupPaused)}>
              <SubmitButton variant="outline">
                {s.backupPaused ? "Resume schedules" : "Pause schedules"}
              </SubmitButton>
            </form>
          )}
        </div>
        <SetupNotes b={b} />
      </section>

      <Section title="What gets backed up">
        {b.kinds.map((k) => {
          const sch = k.schedule
          const plan = !sch.enabled
            ? "Not scheduled"
            : `Every ${sch.intervalHours === 24 ? "day" : `${sch.intervalHours} h`} from ${sch.start} ${sch.tz}`
          return (
            <div
              key={k.kind}
              className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-6"
            >
              <div className="grid min-w-0 gap-0.5">
                <p className="text-sm font-medium">{KIND_LABEL[k.kind]}</p>
                <p className="text-sm text-muted-foreground">
                  {k.kind === "db"
                    ? "Dumped, restored into a throwaway Postgres and compared row by row, then uploaded."
                    : "Every file and version, copied once and checked by reading a sample back."}
                </p>
              </div>
              <div className="grid gap-0.5 text-sm">
                <span className="text-muted-foreground">Last good</span>
                <span className="tabular-nums">
                  {k.lastGood
                    ? `${ago(k.lastGood.startedAt.toISOString(), now)}${k.lastGood.sizeBytes ? ` · ${formatBytes(k.lastGood.sizeBytes)}${k.kind === "files" ? " new" : ""}` : ""}`
                    : "Never"}
                </span>
              </div>
              <div className="grid gap-0.5 text-sm">
                <span className="text-muted-foreground">{plan}</span>
                <span className="tabular-nums">
                  {k.last?.status === "running" ? (
                    <Link
                      href={`${BASE}/history?run=${k.last.id}`}
                      className="text-brand underline-offset-4 hover:underline"
                    >
                      Running now
                    </Link>
                  ) : k.next ? (
                    `Next ${until(k.next, now)}`
                  ) : sch.enabled && s.backupPaused ? (
                    "Paused"
                  ) : (
                    <Link
                      href={`${BASE}/settings#backup-${k.kind === "db" ? "db" : "files"}-schedule`}
                      className="underline-offset-4 hover:underline"
                    >
                      Set a schedule
                    </Link>
                  )}
                </span>
              </div>
              <BackupNow
                kind={k.kind}
                disabled={!ready || k.last?.status === "running"}
              />
            </div>
          )
        })}
      </Section>

      <section aria-labelledby="trends" className="flex flex-col gap-3">
        <h2 id="trends" className="text-base font-semibold">
          Trends
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Trend
            title="Database size"
            peak={formatBytes(
              Math.max(0, ...dbRuns.map((r) => r.dbSizeBytes ?? 0))
            )}
            points={points(dbRuns, (r) => r.dbSizeBytes, formatBytes)}
          />
          <Trend
            title="Dump size"
            peak={formatBytes(
              Math.max(0, ...dbRuns.map((r) => r.sizeBytes ?? 0))
            )}
            points={points(dbRuns, (r) => r.sizeBytes, formatBytes)}
          />
          <Trend
            title="Database backup time"
            peak={fmtSecs(Math.max(0, ...dbRuns.map((r) => secs(r) ?? 0)))}
            points={points(dbRuns, secs, fmtSecs)}
          />
          <Trend
            title="Files in backup"
            peak={formatBytes(
              Math.max(0, ...fileRuns.map((r) => r.stats.totalBytes ?? 0))
            )}
            points={points(
              fileRuns,
              (r) => r.stats.totalBytes ?? null,
              formatBytes
            )}
          />
        </div>
      </section>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Section
          title="Storage"
          description={
            b.dest?.fromEnv ? (
              <span className="flex flex-wrap items-center gap-2">
                Set in env. <Badge variant="outline">From environment</Badge>
              </span>
            ) : undefined
          }
        >
          <dl className="divide-y text-sm">
            {[
              [
                "Where",
                b.dest
                  ? `${PROVIDER_LABEL[b.dest.provider]} · ${b.dest.bucket}${b.dest.folder ? `/${b.dest.folder}` : ""}`
                  : "Not set up",
              ],
              [
                "Database dumps kept",
                `${b.stored.dumps.n} · ${formatBytes(b.stored.dumps.bytes)}`,
              ],
              [
                "Files in the mirror",
                `${b.stored.mirror.n} · ${formatBytes(b.stored.mirror.bytes)}`,
              ],
              [
                "Estimated cost",
                cents === null
                  ? b.dest
                    ? `No list price for ${PROVIDER_LABEL[b.dest.provider]}`
                    : "—"
                  : `About $${(cents / 100).toFixed(2)} a month for storage`,
              ],
            ].map(([k, v]) => (
              <div
                key={k}
                className="grid grid-cols-[minmax(0,10rem)_1fr] gap-4 px-4 py-3"
              >
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="min-w-0 truncate tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-base font-semibold">Recent runs</h2>
            <Link
              href={`${BASE}/history`}
              className="flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              All history <ArrowRightIcon className="size-3.5" />
            </Link>
          </div>
          <div className={cn(FRAME, "divide-y")}>
            {recent.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                No backups yet.
              </p>
            )}
            {recent.map((r) => (
              <Link
                key={r.id}
                href={`${BASE}/history?run=${r.id}`}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 px-4 py-3 text-sm outline-none first:rounded-t-xl last:rounded-b-xl hover:bg-input/20 focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:grid-cols-[7rem_minmax(0,1fr)_6rem_auto]"
              >
                <StatusLabel status={r.status} />
                <span className="min-w-0 truncate max-sm:order-last max-sm:col-span-2 max-sm:text-muted-foreground">
                  {KIND_LABEL[r.kind]}
                  <span className="text-muted-foreground">
                    {r.trigger === "reverify"
                      ? " · re-verify"
                      : r.trigger === "manual"
                        ? " · by hand"
                        : r.trigger === "retry"
                          ? ` · retry ${r.attempt}`
                          : ""}
                  </span>
                </span>
                <span className="hidden text-muted-foreground tabular-nums sm:block">
                  {duration(r.startedAt, r.finishedAt) ?? "…"}
                </span>
                <span className="text-right text-muted-foreground tabular-nums">
                  {when(r.startedAt)}
                </span>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </AdminPage>
  )
}
