import {
  AdminPage,
  SELECT,
  Section,
  SettingRow,
  SettingsForm,
  resettable,
} from "@/components/admin/setting"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { INTERVALS, PROVIDER_LABEL, type Kind } from "@/lib/backup-rules"
import { envDest } from "@/lib/backup/dest"
import { isUnlocked, reauthMethod } from "@/lib/backup/reauth"
import { decrypt } from "@/lib/crypto"
import { requireAdmin } from "@/lib/session"
import { getSettings } from "@/lib/signup"
import { saveAlerts, saveFiles, saveRetention, saveSchedules } from "../actions"
import { Reauth, StorageForm } from "../backups-client"
import { BASE, Tabs } from "../parts"

export const metadata = { title: "Backup settings · Admin · Nimbus" }

// ICU still lists some zones by their old names; people look for the current ones.
const RENAMED: Record<string, string> = {
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Europe/Kiev": "Europe/Kyiv",
  "Atlantic/Faeroe": "Atlantic/Faroe",
}

const every = (h: number) =>
  h === 24 ? "Every day" : h === 1 ? "Every hour" : `Every ${h} hours`

function Schedule({
  kind,
  on,
  hours,
  start,
}: {
  kind: Kind
  on: boolean
  hours: number
  start: string
}) {
  return (
    <>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name={`${kind}Enabled`}
          defaultChecked={on}
          className="size-4 shrink-0 accent-primary"
        />
        On a schedule
      </label>
      <div className="grid grid-cols-[minmax(0,1fr)_8.5rem] gap-2">
        <select
          name={`${kind}Interval`}
          defaultValue={hours}
          aria-label="How often"
          className={SELECT}
        >
          {INTERVALS.map((h) => (
            <option key={h} value={h}>
              {every(h)}
            </option>
          ))}
        </select>
        <Input
          type="time"
          name={`${kind}Start`}
          defaultValue={start}
          aria-label="Starting at"
          required
          className="tabular-nums"
        />
      </div>
    </>
  )
}

const num = "w-24 tabular-nums"

function Unit({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      {children}
    </div>
  )
}

export default async function BackupSettingsPage() {
  const me = await requireAdmin()
  const [s, unlocked, method] = await Promise.all([
    getSettings(),
    isUnlocked(),
    reauthMethod(me),
  ])
  const reset = resettable(s)
  const r = s.backupRetention
  const env = envDest()
  const access = s.backupAccessKey ? decrypt(s.backupAccessKey) : null
  const sealedLost = Boolean(
    (s.backupAccessKey && access === null) ||
    (s.backupSecretKey && decrypt(s.backupSecretKey) === null)
  )
  const zones = [
    "UTC",
    ...Intl.supportedValuesOf("timeZone")
      .filter((z) => z !== "UTC")
      .map((z) => RENAMED[z] ?? z),
  ]

  return (
    <AdminPage
      wide
      title="Backups"
      description="When backups run, how long they're kept, and where they go."
    >
      <Tabs current={`${BASE}/settings`} />
      <div className="flex max-w-3xl flex-col gap-10">
        <SettingsForm
          action={saveSchedules}
          title="Schedule"
          description="Each kind runs on its own schedule, at the same local times every day. Needs the backup worker (npm run worker:backup)."
          risks={[
            {
              name: "dbEnabled",
              when: "unchecked",
              message:
                "Without a database schedule, the database is only backed up when someone presses Back up now.",
            },
            {
              name: "filesEnabled",
              when: "unchecked",
              message:
                "Without a file schedule, new uploads aren't copied until someone presses Back up now.",
            },
          ]}
        >
          <SettingRow
            id="backup-db-schedule"
            label="Database"
            hint="Every account, folder, share and setting. Small and quick, so it can run often."
            tip={{
              does: "How often the database is dumped, checked in a throwaway Postgres, and uploaded.",
              affects: "Scheduled database backups.",
              default: "Every 6 hours from 03:00",
              example: "Every hour for a busy team",
            }}
            reset={reset("backupDbIntervalH", "backupDbStart")}
          >
            <Schedule
              kind="db"
              on={s.backupDbEnabled}
              hours={s.backupDbIntervalH}
              start={s.backupDbStart}
            />
          </SettingRow>
          <SettingRow
            id="backup-files-schedule"
            label="Files"
            hint="Copies only what's new since the last run, so later runs are quick."
            tip={{
              does: "How often new files and versions are copied to the backup bucket.",
              affects: "Scheduled file backups.",
              default: "Every day from 02:00",
              example: "Every 6 hours if people upload a lot",
            }}
            reset={reset("backupFilesIntervalH", "backupFilesStart")}
          >
            <Schedule
              kind="files"
              on={s.backupFilesEnabled}
              hours={s.backupFilesIntervalH}
              start={s.backupFilesStart}
            />
          </SettingRow>
          <SettingRow
            id="backup-timezone"
            label="Time zone"
            htmlFor="tz"
            hint="The start times above are in this zone."
            reset={reset("backupTz")}
          >
            <select
              id="tz"
              name="tz"
              defaultValue={s.backupTz}
              className={SELECT}
            >
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </SettingRow>
        </SettingsForm>

        <SettingsForm
          action={saveRetention}
          title="Keeping database backups"
          description="Pinned backups and the newest good one are never deleted, whatever these say. Files of failed runs go after 7 days."
        >
          <div className="[&:has(input[value=newest]:checked)_[data-mode=tiered]]:hidden [&:has(input[value=tiered]:checked)_[data-mode=newest]]:hidden">
            <SettingRow
              id="backup-retention"
              label="How to keep them"
              stacked
              reset={reset("backupRetention")}
            >
              <fieldset className="grid gap-2 sm:grid-cols-2">
                <legend className="sr-only">How to keep old backups</legend>
                {[
                  {
                    v: "tiered",
                    l: "Thin out over time",
                    h: "Everything recent, then one a day, a week, a month.",
                  },
                  {
                    v: "newest",
                    l: "Keep the newest",
                    h: "A fixed number of the latest backups.",
                  },
                ].map((o) => (
                  <label
                    key={o.v}
                    className="flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors hover:bg-input/20 has-checked:border-ring/60 has-checked:bg-input/30 has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50"
                  >
                    <input
                      type="radio"
                      name="mode"
                      value={o.v}
                      defaultChecked={
                        (r.mode === "last_n" ? "newest" : "tiered") === o.v
                      }
                      className="mt-0.5 size-4 shrink-0 accent-primary outline-none"
                    />
                    <span className="grid gap-1">
                      <span className="text-sm font-medium">{o.l}</span>
                      <span className="text-sm text-muted-foreground">
                        {o.h}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
            </SettingRow>
            <div data-mode="newest" className="border-t">
              <SettingRow
                id="backup-keep-last"
                label="Backups to keep"
                htmlFor="keepLast"
                hint="The newest this many good backups."
              >
                <Unit>
                  <Input
                    id="keepLast"
                    name="keepLast"
                    type="number"
                    min={1}
                    max={10000}
                    defaultValue={r.mode === "last_n" ? r.keepLast : 30}
                    className={num}
                  />
                  backups
                </Unit>
              </SettingRow>
            </div>
            <div data-mode="tiered" className="divide-y border-t">
              {(
                [
                  [
                    "hours",
                    "Keep every backup for",
                    "hours",
                    r.mode === "tiered" ? r.hours : 48,
                    720,
                  ],
                  [
                    "days",
                    "Then one a day for",
                    "days",
                    r.mode === "tiered" ? r.days : 30,
                    3650,
                  ],
                  [
                    "weeks",
                    "Then one a week for",
                    "weeks",
                    r.mode === "tiered" ? r.weeks : 12,
                    520,
                  ],
                  [
                    "months",
                    "Then one a month for",
                    "months",
                    r.mode === "tiered" ? r.months : 12,
                    240,
                  ],
                ] as const
              ).map(([name, label, unit, value, max]) => (
                <SettingRow
                  key={name}
                  id={`backup-tier-${name}`}
                  label={label}
                  htmlFor={name}
                >
                  <Unit>
                    <Input
                      id={name}
                      name={name}
                      type="number"
                      min={0}
                      max={max}
                      defaultValue={value}
                      className={num}
                    />
                    {unit}
                  </Unit>
                </SettingRow>
              ))}
            </div>
          </div>
        </SettingsForm>

        <SettingsForm
          action={saveFiles}
          title="Files"
          risks={[
            {
              name: "encrypt",
              when: "unchecked",
              message:
                "New copies will be readable by anyone who can read the backup bucket. Vault files stay encrypted either way.",
            },
          ]}
        >
          <SettingRow
            id="backup-files-encrypt"
            label="Encrypt copies"
            hint="With BACKUP_ENCRYPTION_KEY, so the backup provider can't read your files. Applies to files copied from now on."
            reset={reset("backupFilesEncrypt")}
          >
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="encrypt"
                defaultChecked={s.backupFilesEncrypt}
                className="size-4 shrink-0 accent-primary"
              />
              Encrypt
            </label>
          </SettingRow>
          <SettingRow
            id="backup-files-grace"
            label="Keep purged files"
            htmlFor="grace"
            hint="After a file leaves Nimbus's trash for good, its copy stays this long in case it went by mistake."
            reset={reset("backupFilesGraceDays")}
          >
            <Unit>
              <Input
                id="grace"
                name="grace"
                type="number"
                min={1}
                max={3650}
                defaultValue={s.backupFilesGraceDays}
                className={num}
              />
              days
            </Unit>
          </SettingRow>
          <SettingRow
            id="backup-files-speed"
            label="Files at a time"
            htmlFor="concurrency"
            hint="More copies in parallel finish sooner but use more bandwidth and memory."
            reset={reset("backupFilesConcurrency")}
          >
            <Input
              id="concurrency"
              name="concurrency"
              type="number"
              min={1}
              max={32}
              defaultValue={s.backupFilesConcurrency}
              className={num}
            />
          </SettingRow>
          <SettingRow
            id="backup-files-sample"
            label="Read back after each run"
            htmlFor="sample"
            hint="This share of the backed-up files, at least 20, is downloaded and checked against its original fingerprint."
            reset={reset("backupFilesSamplePct")}
          >
            <Unit>
              <Input
                id="sample"
                name="sample"
                type="number"
                min={0}
                max={100}
                defaultValue={s.backupFilesSamplePct}
                className={num}
              />
              %
            </Unit>
          </SettingRow>
        </SettingsForm>

        <SettingsForm
          action={saveAlerts}
          title="Alerts"
          description="Admins get these in the bell, and by email unless they turned backup emails off under Account."
        >
          <SettingRow
            id="backup-alerts"
            label="Tell admins when"
            reset={reset("backupAlerts")}
          >
            {(
              [
                ["failure", "A backup fails", "After its retries run out."],
                [
                  "warning",
                  "A backup has a warning",
                  "It shrank a lot, or the live data breaks a foreign key.",
                ],
                [
                  "stale",
                  "Backups stop",
                  "No good backup in twice the interval.",
                ],
              ] as const
            ).map(([v, l, h]) => (
              <label key={v} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  name={`alert:${v}`}
                  defaultChecked={s.backupAlerts.includes(v)}
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                />
                <span className="grid gap-0.5">
                  <span>{l}</span>
                  <span className="text-muted-foreground">{h}</span>
                </span>
              </label>
            ))}
          </SettingRow>
          <SettingRow
            id="backup-retries"
            label="Retry a failed backup"
            htmlFor="retries"
            hint="Most failures are a network blip. The alert waits for the last try."
            reset={reset("backupRetryAttempts", "backupRetryDelayMin")}
          >
            <Unit>
              <Input
                id="retries"
                name="retries"
                type="number"
                min={0}
                max={10}
                defaultValue={s.backupRetryAttempts}
                className={num}
                aria-label="Retries"
              />
              times,
              <Input
                name="retryDelay"
                type="number"
                min={1}
                max={1440}
                defaultValue={s.backupRetryDelayMin}
                className={num}
                aria-label="Minutes between tries"
              />
              min apart
            </Unit>
          </SettingRow>
          <SettingRow
            id="backup-shrink"
            label="Warn when a dump shrinks by"
            htmlFor="shrink"
            hint="Compared with the last good one. Blank turns it off."
            reset={reset("backupShrinkWarnPct")}
          >
            <Unit>
              <Input
                id="shrink"
                name="shrink"
                type="number"
                min={1}
                max={99}
                defaultValue={s.backupShrinkWarnPct ?? ""}
                className={num}
              />
              %
            </Unit>
          </SettingRow>
        </SettingsForm>

        <Section
          title="Storage"
          description={
            env ? (
              <span className="flex flex-wrap items-center gap-2">
                Set in env, so it&apos;s read-only here.{" "}
                <Badge variant="outline">From environment</Badge>
              </span>
            ) : (
              "Use a different provider, or at least a different bucket and keys, from where Nimbus keeps its files."
            )
          }
        >
          <div id="backup-storage" className="scroll-mt-24">
            {env ? (
              <dl className="divide-y text-sm">
                {[
                  [
                    "BACKUP_S3_PROVIDER",
                    PROVIDER_LABEL[env.provider] ?? env.provider,
                  ],
                  ["BACKUP_S3_ENDPOINT", env.endpoint ?? "Amazon S3"],
                  ["BACKUP_S3_BUCKET", env.bucket],
                  ["BACKUP_S3_FOLDER", env.folder || "(top level)"],
                  ["BACKUP_S3_REGION", env.region],
                  ["BACKUP_S3_ACCESS_KEY", env.accessKey ? "Set" : "Not set"],
                ].map(([k, v]) => (
                  <div
                    key={k}
                    className="grid grid-cols-[minmax(0,13rem)_1fr] gap-4 px-4 py-2.5"
                  >
                    <dt className="truncate font-mono text-xs leading-5 text-muted-foreground">
                      {k}
                    </dt>
                    <dd className="truncate">{v}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <>
                {!unlocked && (
                  <div className="flex flex-col gap-3 border-b p-4">
                    <p className="text-sm text-pretty text-muted-foreground">
                      These keys can read every backup, so confirm it&apos;s you
                      to change them. You can test a connection without that.
                    </p>
                    <Reauth method={method} email={me.email} />
                  </div>
                )}
                <StorageForm
                  locked={!unlocked}
                  values={{
                    provider: s.backupProvider ?? "aws",
                    endpoint: s.backupEndpoint ?? "",
                    region: s.backupRegion ?? "",
                    bucket: s.backupBucket ?? "",
                    folder: s.backupFolder,
                    pathStyle: s.backupPathStyle,
                    accessKeyHint: access?.slice(-4) ?? null,
                    hasSecret: Boolean(s.backupSecretKey),
                    sealedLost,
                  }}
                />
              </>
            )}
          </div>
        </Section>
      </div>
    </AdminPage>
  )
}
