import { PaperPlaneTiltIcon } from "@phosphor-icons/react/dist/ssr"
import { desc, eq, gt, isNull, and, sql } from "drizzle-orm"

import {
  AdminPage,
  SELECT,
  Section,
  SettingRow,
  SettingsForm,
  resettable,
  sizeField,
} from "@/components/admin/setting"
import { SubmitButton } from "@/components/submit-button"
import { Input } from "@/components/ui/input"
import { db } from "@/lib/db"
import { transferFiles, transfers, user } from "@/lib/db/schema"
import { formatBytes } from "@/lib/file-rules"
import { getSettings } from "@/lib/signup"
import { revokeTransfer, setTransferPolicy } from "../../actions"

export const metadata = { title: "Transfers · Admin · Nimbus" }

const date = new Intl.DateTimeFormat("en", { dateStyle: "medium" })
const CHECK = "size-4 shrink-0 accent-primary self-start sm:self-end"

export default async function TransfersPage() {
  const s = await getSettings()
  const reset = resettable(s)
  const size = sizeField(s.transferMaxBytes, "MB", "GB")
  // Live transfers only; the hourly purge deletes the rest. Admins can stop one, not open it.
  const rows = await db
    .select({
      id: transfers.id,
      title: transfers.title,
      sender: user.name,
      senderEmail: user.email,
      expiresAt: transfers.expiresAt,
      downloads: transfers.downloads,
      files: sql<number>`count(${transferFiles.id})::int`,
      bytes: sql<string>`coalesce(sum(${transferFiles.size}), 0)::text`,
    })
    .from(transfers)
    .innerJoin(user, eq(user.id, transfers.senderId))
    .leftJoin(transferFiles, eq(transferFiles.transferId, transfers.id))
    .where(
      and(
        isNull(transfers.revokedAt),
        eq(transfers.draft, false),
        gt(transfers.expiresAt, sql`now()`)
      )
    )
    .groupBy(transfers.id, user.id)
    .orderBy(desc(transfers.createdAt))
  const total = rows.reduce((n, r) => n + Number(r.bytes), 0)

  return (
    <AdminPage
      title="Transfers"
      description="Members send copies of files by link or email. Copies are deleted when a transfer expires and count against the sender's storage until then."
    >
      <SettingsForm action={setTransferPolicy} title="Policy">
        <SettingRow
          id="allow-transfers"
          label="Allow Transfer"
          htmlFor="enabled"
          hint="Off: Transfer is hidden and no transfer opens. Copies are still deleted at expiry."
          tip={{
            does: "Turns Transfer on or off for everyone.",
            affects: "Every member and every transfer link.",
            default: "On",
          }}
          reset={reset("transfersEnabled")}
        >
          <input
            type="checkbox"
            id="enabled"
            name="enabled"
            defaultChecked={s.transfersEnabled}
            className={CHECK}
          />
        </SettingRow>
        <SettingRow
          id="transfer-expiry"
          label="Longest transfer lifetime"
          htmlFor="maxDays"
          hint="In days, up to 30. Blank allows 30."
          tip={{
            does: "Members pick 1, 7 or 30 days; choices past this are hidden.",
            affects: "Transfers sent from now on.",
            default: "30 days",
            example: "7",
          }}
          reset={reset("transferMaxDays")}
        >
          <Input
            id="maxDays"
            name="maxDays"
            type="number"
            min={1}
            max={30}
            step={1}
            defaultValue={s.transferMaxDays ?? ""}
            placeholder="30"
          />
        </SettingRow>
        <SettingRow
          id="transfer-size"
          label="Biggest transfer"
          htmlFor="maxSize"
          hint="All files in one transfer together. Blank: only the sender's storage limits it."
          tip={{
            does: "Refuses a transfer whose files add up to more than this.",
            affects: "Transfers sent from now on.",
            default: "No limit",
            example: "10 GB",
          }}
          reset={reset("transferMaxBytes")}
        >
          <div className="grid grid-cols-[1fr_6rem] gap-2">
            <Input
              id="maxSize"
              name="maxSize"
              type="number"
              min={0.01}
              step="any"
              defaultValue={size.value}
              placeholder="No limit"
            />
            <select
              aria-label="Unit"
              name="unit"
              defaultValue={size.unit}
              className={SELECT}
            >
              <option value="MB">MB</option>
              <option value="GB">GB</option>
              <option value="TB">TB</option>
            </select>
          </div>
        </SettingRow>
      </SettingsForm>

      <section id="active-transfers" className="flex scroll-mt-24 flex-col gap-3">
        <div className="grid gap-1">
          <h2 className="text-base font-semibold">
            Active transfers{" "}
            <span className="font-normal text-muted-foreground tabular-nums">
              {rows.length}
            </span>
          </h2>
          <p className="text-sm text-pretty text-muted-foreground">
            {rows.length
              ? `${formatBytes(total)} held in copies. Revoking stops the links; the copies go in the next hourly clean-up.`
              : "Revoking stops a transfer's links; its copies go in the next hourly clean-up."}
          </p>
        </div>
        {rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-input px-6 py-12 text-center text-sm text-muted-foreground">
            No transfers are active.
          </p>
        ) : (
          <Section>
            <ul className="flex flex-col divide-y">
              {rows.map((t) => (
                <li
                  key={t.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                    <PaperPlaneTiltIcon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="truncate text-sm font-medium">
                      {t.title || `${t.files} file${t.files === 1 ? "" : "s"}`}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">
                      {t.sender} ({t.senderEmail})
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground tabular-nums">
                    <span>
                      {t.files} file{t.files === 1 ? "" : "s"} ·{" "}
                      {formatBytes(Number(t.bytes))} · {t.downloads} downloads
                    </span>
                    <span>Expires {date.format(t.expiresAt)}</span>
                  </div>
                  <form action={revokeTransfer.bind(null, t.id)}>
                    <SubmitButton size="sm" variant="destructive">
                      Revoke
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </section>
    </AdminPage>
  )
}
