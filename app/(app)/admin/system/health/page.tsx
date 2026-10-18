import {
  CheckCircleIcon,
  ClockIcon,
  WarningCircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react/dist/ssr"
import Link from "next/link"

import {
  AdminPage,
  FRAME,
  SELECT,
  SettingRow,
  SettingsForm,
  resettable,
} from "@/components/admin/setting"
import { SubmitButton } from "@/components/submit-button"
import { Input } from "@/components/ui/input"
import { RANGES, healthOverview, type Range } from "@/lib/health"
import {
  DEFAULT_SLOW_MS,
  INTERVALS,
  SERVICES,
  SERVICE_LABEL,
  ago,
} from "@/lib/health-rules"
import { getSettings } from "@/lib/signup"
import { cn } from "@/lib/utils"
import {
  runHealthChecks,
  setHealthSchedule,
  setHealthServices,
} from "./actions"
import { AutoRefresh, HealthList } from "./health-list"

export const metadata = { title: "Health · Admin · Nimbus" }

const list = (names: string[]) =>
  names.length < 3
    ? names.join(" and ")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`

export default async function HealthPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>
}) {
  const range: Range = (await searchParams).range === "7d" ? "7d" : "24h"
  const [s, h] = await Promise.all([getSettings(), healthOverview(range)])
  const reset = resettable(s)

  const named = (pick: (x: (typeof h.services)[number]) => boolean) =>
    h.services.filter(pick).map((x) => x.label)
  const down = named((x) => x.status === "down")
  const failing = named((x) => x.status === "degraded" && x.outcome === "fail")
  const slow = named((x) => x.status === "degraded" && x.outcome === "slow")
  const verb = (n: string[]) => (n.length === 1 ? "is" : "are")

  const [Icon, tone, headline] = down.length
    ? [XCircleIcon, "text-destructive", `${list(down)} ${verb(down)} down`]
    : failing.length
      ? [
          WarningCircleIcon,
          "text-warning",
          `${list(failing)} failed the last check`,
        ]
      : slow.length
        ? [
            WarningCircleIcon,
            "text-warning",
            `${list(slow)} ${verb(slow)} slow`,
          ]
        : h.lastRun
          ? [CheckCircleIcon, "text-success", "Everything is working"]
          : [ClockIcon, "text-muted-foreground", "Not checked yet"]

  return (
    <AdminPage
      wide
      title="Health"
      description="Checks every service this Nimbus depends on, on a schedule, and tells admins when one goes down."
    >
      <AutoRefresh />
      <section aria-label="Status" className="flex flex-col gap-3">
        <div
          className={cn(
            FRAME,
            "flex flex-wrap items-center gap-x-6 gap-y-4 px-5 py-4"
          )}
        >
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Icon weight="fill" className={cn("size-7 shrink-0", tone)} />
            <div className="grid min-w-0 gap-0.5">
              <p className="text-base font-semibold text-balance">{headline}</p>
              <p className="text-sm text-muted-foreground">
                {h.lastRun
                  ? `Last checked ${ago(h.lastRun, h.to)}`
                  : "No results in this range"}
                {" · "}
                {s.healthIntervalMin
                  ? `every ${s.healthIntervalMin} min`
                  : "scheduled checks are off"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <nav
              aria-label="Range"
              className="flex rounded-md border bg-input/30 p-0.5"
            >
              {(Object.keys(RANGES) as Range[]).map((r) => (
                <Link
                  key={r}
                  href={`?range=${r}`}
                  scroll={false}
                  aria-current={r === range ? "page" : undefined}
                  className="rounded-[5px] px-2.5 py-1 text-xs font-medium text-muted-foreground tabular-nums outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-[current=page]:bg-accent aria-[current=page]:text-foreground"
                >
                  {r === "24h" ? "24 hours" : "7 days"}
                </Link>
              ))}
            </nav>
            <form action={runHealthChecks}>
              <SubmitButton variant="outline">Run checks now</SubmitButton>
            </form>
          </div>
        </div>

        {h.stale && (
          <div
            role="status"
            className="flex gap-3 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm"
          >
            <WarningCircleIcon
              weight="fill"
              className="mt-0.5 size-4 shrink-0 text-warning"
            />
            <p className="text-pretty">
              <span className="font-medium">
                {h.heartbeat
                  ? `Scheduled checks stopped. The last one ran ${ago(h.heartbeat, h.to)}.`
                  : "Scheduled checks aren't running."}
              </span>{" "}
              <span className="text-muted-foreground">
                Start the worker with{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">
                  npm run worker
                </code>{" "}
                next to the app. Until then, nobody is told when a service goes
                down.
              </span>
            </p>
          </div>
        )}
      </section>

      <HealthList services={h.services} from={h.from} to={h.to} range={range} />

      <div className="flex max-w-3xl flex-col gap-10">
        <SettingsForm
          action={setHealthSchedule}
          title="Schedule"
          risks={[
            {
              name: "interval",
              when: "equals",
              value: "",
              message:
                "With scheduled checks off, admins only find out a service is down when someone runs the checks here.",
            },
          ]}
        >
          <SettingRow
            id="health-interval"
            label="Check every"
            htmlFor="interval"
            hint="Needs the worker running (npm run worker)."
            tip={{
              does: "How often every service is checked in the background.",
              affects: "Scheduled checks. Run checks now works either way.",
              default: "5 minutes",
              example: "1 minute for a busy team, 15 for a home server",
            }}
            reset={reset("healthIntervalMin")}
          >
            <select
              id="interval"
              name="interval"
              defaultValue={s.healthIntervalMin ?? ""}
              className={SELECT}
            >
              {INTERVALS.map((m) => (
                <option key={m} value={m}>
                  {m === 60 ? "1 hour" : m === 1 ? "1 minute" : `${m} minutes`}
                </option>
              ))}
              <option value="">Off</option>
            </select>
          </SettingRow>
          <SettingRow
            id="health-failures"
            label="Alert after"
            htmlFor="failures"
            hint="Failed checks in a row before a service counts as down and admins are told. Fewer show it as failing."
            tip={{
              does: "Waits for a failure to repeat, so one blip doesn't wake anyone.",
              affects: "When a service shows as down, and the alerts.",
              default: "2 checks",
              example: "1 to hear about every failure",
            }}
            reset={reset("healthFailures")}
          >
            <Input
              id="failures"
              name="failures"
              type="number"
              min={1}
              max={10}
              step={1}
              required
              defaultValue={s.healthFailures}
            />
          </SettingRow>
          <SettingRow
            id="health-retention"
            label="Keep history for"
            htmlFor="retention"
            hint="Days of results kept for the uptime bars and incidents."
            tip={{
              does: "Deletes check results older than this.",
              affects: "History on this page.",
              default: "30 days",
            }}
            reset={reset("healthRetentionDays")}
          >
            <Input
              id="retention"
              name="retention"
              type="number"
              min={1}
              max={365}
              step={1}
              required
              defaultValue={s.healthRetentionDays}
            />
          </SettingRow>
        </SettingsForm>

        <SettingsForm action={setHealthServices} title="Services">
          <SettingRow
            id="health-services"
            label="Check these"
            hint="Turn off a service you don't run, so it stays quiet."
            tip={{
              does: "Skips the check for a service. It shows as off here and never alerts.",
              affects: "Scheduled checks and Run checks now.",
              default: "All on",
            }}
            reset={reset("healthDisabled")}
            stacked
          >
            <fieldset className="grid gap-2.5 sm:grid-cols-2">
              <legend className="sr-only">Services to check</legend>
              {SERVICES.map((x) => (
                <label
                  key={x}
                  className="flex cursor-pointer items-center gap-2.5 text-sm"
                >
                  <input
                    type="checkbox"
                    name={`check:${x}`}
                    defaultChecked={!s.healthDisabled.includes(x)}
                    className="size-4 accent-primary"
                  />
                  {SERVICE_LABEL[x]}
                </label>
              ))}
            </fieldset>
          </SettingRow>
          <SettingRow
            id="health-slow"
            label="Slow above"
            hint="Milliseconds. A service that answers slower than this shows as slow. Blank uses the default."
            tip={{
              does: "Sets when a working service counts as slow instead of fine.",
              affects: "Status here. Slow never sends an alert.",
              default: "Shown in each field",
              example: "Storage on a far-away bucket: 3000",
            }}
            reset={reset("healthSlowMs")}
            stacked
          >
            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {SERVICES.filter((x) => DEFAULT_SLOW_MS[x]).map((x) => (
                <label
                  key={x}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  {SERVICE_LABEL[x]}
                  <span className="relative w-28 shrink-0">
                    <Input
                      name={`slow:${x}`}
                      type="number"
                      min={1}
                      max={60000}
                      step={1}
                      defaultValue={s.healthSlowMs[x] ?? ""}
                      placeholder={String(DEFAULT_SLOW_MS[x])}
                      className="pr-9 tabular-nums"
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
                      ms
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </SettingRow>
        </SettingsForm>
      </div>
    </AdminPage>
  )
}
