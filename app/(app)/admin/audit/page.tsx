import { and, desc, eq, lt, type SQL } from "drizzle-orm"
import Link from "next/link"

import { AdminPage, FRAME } from "@/components/admin/setting"
import { db } from "@/lib/db"
import { auditEvents } from "@/lib/db/schema"
import { formatBytes } from "@/lib/file-rules"

export const metadata = { title: "Audit log · Admin · Nimbus" }

const PAGE = 100
const when = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
})

const bytes = (d: string | null, unit = "") =>
  d === "default" || !d ? "the default" : `${formatBytes(Number(d))}${unit}`

// What happened, in words. `who` is the member it was done to.
function sentence(e: typeof auditEvents.$inferSelect, who: string) {
  const d = e.detail
  switch (e.action) {
    case "status":
      return d === "active"
        ? `approved ${who}`
        : d === "rejected"
          ? `rejected ${who}`
          : `moved ${who} back to pending`
    case "role":
      return d === "admin" ? `made ${who} an admin` : `made ${who} a member`
    case "quota":
      return `set ${who}'s storage limit to ${bytes(d)}`
    case "upload_speed":
      return `set ${who}'s upload speed to ${bytes(d, "/s")}`
    case "reset_2fa":
      return `reset two-factor for ${who}`
    case "temp_password":
      return `gave ${who} a temporary password`
    case "delete_vault":
      return `deleted ${who}'s vault “${d}”`
    case "webdav":
      return `turned WebDAV ${d} for ${who}`
    case "revoke_app_password":
      return `revoked ${who}'s app password “${d}”`
    case "invite_create":
      return "made an invite link"
    case "invite_revoke":
      return "revoked an invite link"
    case "link_revoke":
      return `revoked a public link of ${who}`
    case "backup_download":
      return "downloaded a database backup"
    case "settings":
      return "changed settings"
    default:
      return e.action
  }
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ member?: string; before?: string }>
}) {
  const { member, before } = await searchParams
  const where: SQL[] = []
  if (member) where.push(eq(auditEvents.targetId, member))
  const cut = before ? new Date(before) : null
  if (cut && !isNaN(+cut)) where.push(lt(auditEvents.at, cut))
  const rows = await db
    .select()
    .from(auditEvents)
    .where(and(...where))
    .orderBy(desc(auditEvents.at))
    .limit(PAGE + 1)
  const more = rows.length > PAGE
  const shown = rows.slice(0, PAGE)
  const older = new URLSearchParams({
    ...(member && { member }),
    before: shown.at(-1)?.at.toISOString() ?? "",
  })

  return (
    <AdminPage
      wide
      title="Audit log"
      description="What admins changed and who did it: approvals, roles, account recovery, vault deletes and settings. Kept for a year."
    >
      {member && (
        <p className="-mt-4 text-sm text-muted-foreground">
          Showing changes to {shown[0]?.targetName ?? "one member"}.{" "}
          <Link href="/admin/audit" className="underline underline-offset-4">
            Show everything
          </Link>
        </p>
      )}
      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-input px-4 py-8 text-center text-sm text-muted-foreground">
          Nothing yet. Changes admins make show up here.
        </p>
      ) : (
        <ul className={`${FRAME} divide-y`}>
          {shown.map((e) => {
            const who = e.targetName ?? "a deleted account"
            return (
              <li
                key={e.id}
                className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-baseline sm:gap-4"
              >
                <time
                  dateTime={e.at.toISOString()}
                  className="shrink-0 text-xs text-muted-foreground tabular-nums sm:w-40"
                >
                  {when.format(e.at)}
                </time>
                <div className="grid min-w-0 gap-0.5">
                  <p className="text-sm">
                    <span className="font-medium">{e.actorName}</span>{" "}
                    {sentence(e, who)}
                    {!e.actorId && (
                      <span className="text-muted-foreground">
                        {" "}
                        (account since deleted)
                      </span>
                    )}
                  </p>
                  {e.action === "settings" && e.detail && (
                    <p className="font-mono text-xs break-words text-muted-foreground">
                      {e.detail}
                    </p>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {more && (
        <Link
          href={`/admin/audit?${older}`}
          className="self-start text-sm underline underline-offset-4"
        >
          Older
        </Link>
      )}
    </AdminPage>
  )
}
