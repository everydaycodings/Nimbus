import {
  CheckCircleIcon,
  CircleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react/dist/ssr"
import { count, desc, eq, isNotNull, sql } from "drizzle-orm"
import Link from "next/link"

import { AdminPage, FRAME } from "@/components/admin/setting"
import { UserAvatar } from "@/components/user-avatar"
import { db } from "@/lib/db"
import { nodes, shares, user } from "@/lib/db/schema"
import { canSend, getEmailConfig } from "@/lib/email"
import { formatBytes } from "@/lib/file-rules"
import { getSettings } from "@/lib/signup"

export const metadata = { title: "Overview · Admin · Nimbus" }

const date = new Intl.DateTimeFormat("en", { dateStyle: "medium" })

const MODE_LABEL = {
  approval: "Approval",
  invite: "Invite only",
  open: "Open",
  closed: "Closed",
}

type Check = {
  state: "ok" | "warn" | "off"
  label: string
  detail: string
  href: string
}

const STATE_ICON = {
  ok: <CheckCircleIcon weight="fill" className="size-4 text-brand" />,
  warn: <WarningCircleIcon weight="fill" className="size-4 text-destructive" />,
  off: <CircleIcon className="size-4 text-muted-foreground" />,
}

function Heading({
  title,
  href,
  more,
}: {
  title: string
  href?: string
  more?: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <h2 className="text-base font-semibold">{title}</h2>
      {href && (
        <Link
          href={href}
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {more}
        </Link>
      )}
    </div>
  )
}

export default async function OverviewPage() {
  const s = await getSettings()
  const email = await getEmailConfig()
  const [
    byStatus,
    [{ admins }],
    [{ bytes }],
    [{ links }],
    recentPeople,
    recentLinks,
  ] = await Promise.all([
    db
      .select({ status: user.status, n: count() })
      .from(user)
      .groupBy(user.status),
    db
      .select({ admins: count() })
      .from(user)
      .where(
        sql`${user.role} in ('owner', 'admin') and ${user.status} = 'active'`
      ),
    // Same counting as quotas: each stored object once.
    db.execute<{ bytes: string }>(sql`
        select coalesce(sum(size), 0)::text as bytes from (
          select distinct on (fv.s3_key) fv.size from file_versions fv
        ) k`),
    db
      .select({ links: count() })
      .from(shares)
      .where(
        sql`${shares.token} is not null and (${shares.expiresAt} is null or ${shares.expiresAt} > now())`
      ),
    db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        status: user.status,
        createdAt: user.createdAt,
      })
      .from(user)
      .orderBy(desc(user.createdAt))
      .limit(5),
    db
      .select({
        id: shares.id,
        item: nodes.name,
        owner: user.name,
        createdAt: shares.createdAt,
      })
      .from(shares)
      .innerJoin(nodes, eq(nodes.id, shares.nodeId))
      .innerJoin(user, eq(user.id, nodes.ownerId))
      .where(isNotNull(shares.token))
      .orderBy(desc(shares.createdAt))
      .limit(5),
  ])
  const status = Object.fromEntries(byStatus.map((r) => [r.status, r.n]))
  const pending = status.pending ?? 0

  const stats: [string, string, string][] = [
    ["Members", (status.active ?? 0).toLocaleString("en"), "/admin/members"],
    ["Waiting", pending.toLocaleString("en"), "/admin/approvals"],
    ["Admins", admins.toLocaleString("en"), "/admin/members"],
    ["Stored", formatBytes(Number(bytes)), "/admin/storage/quotas"],
    ["Active links", links.toLocaleString("en"), "/admin/sharing/links"],
  ]

  const checks: Check[] = [
    canSend(email)
      ? {
          state: "ok",
          label: "Email is on",
          detail: "Resets and notices go out.",
          href: "/admin/system/email",
        }
      : {
          state: "warn",
          label: "Email is off",
          detail: "Members who forget a password need an admin.",
          href: "/admin/system/email",
        },
    s.require2fa
      ? {
          state: "ok",
          label: "Two-factor required",
          detail: "Every password account uses it.",
          href: "/admin/authentication",
        }
      : {
          state: "off",
          label: "Two-factor optional",
          detail: "Members choose for themselves.",
          href: "/admin/authentication",
        },
    {
      state: s.signupMode === "open" ? "warn" : "ok",
      label: `Sign-ups: ${MODE_LABEL[s.signupMode]}`,
      detail:
        s.signupMode === "open"
          ? "Anyone can join without a check."
          : s.signupMode === "closed"
            ? "No one new can join."
            : "New people are checked first.",
      href: "/admin/signups",
    },
    s.defaultQuotaBytes === null
      ? {
          state: "off",
          label: "No storage limit",
          detail: "Members can fill the bucket.",
          href: "/admin/storage/quotas",
        }
      : {
          state: "ok",
          label: `${formatBytes(s.defaultQuotaBytes)} per member`,
          detail: "Default storage quota.",
          href: "/admin/storage/quotas",
        },
    s.officeUrl
      ? {
          state: "ok",
          label: "Collabora connected",
          detail: "Office files open in it.",
          href: "/admin/system/office",
        }
      : {
          state: "off",
          label: "Built-in office viewers",
          detail: "No Collabora server set.",
          href: "/admin/system/office",
        },
  ]

  return (
    <AdminPage
      wide
      title="Overview"
      description="How this Nimbus is set up and who's using it."
    >
      <ul
        className={`${FRAME} grid grid-cols-2 overflow-hidden sm:grid-cols-3 lg:grid-cols-5`}
      >
        {stats.map(([k, v, href]) => (
          <li key={k}>
            <Link
              href={href}
              className="grid gap-1 px-4 py-3 transition-colors outline-none hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
            >
              <span className="text-xs text-muted-foreground">{k}</span>
              <span className="text-lg font-semibold tabular-nums">{v}</span>
            </Link>
          </li>
        ))}
      </ul>

      {pending > 0 && (
        <Link
          href="/admin/approvals"
          className={`${FRAME} flex items-center gap-3 px-4 py-3 text-sm transition-colors outline-none hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50`}
        >
          <WarningCircleIcon
            weight="fill"
            className="size-4 shrink-0 text-destructive"
          />
          <span className="flex-1">
            {pending} {pending === 1 ? "person is" : "people are"} waiting for
            approval.
          </span>
          <span className="font-medium">Review</span>
        </Link>
      )}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="flex flex-col gap-3">
          <Heading title="Setup" />
          <ul className={`${FRAME} flex flex-col divide-y`}>
            {checks.map((c) => (
              <li key={c.label}>
                <Link
                  href={c.href}
                  className="flex items-start gap-3 px-4 py-3 transition-colors outline-none hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <span className="mt-0.5">{STATE_ICON[c.state]}</span>
                  <span className="grid gap-0.5">
                    <span className="text-sm font-medium">{c.label}</span>
                    <span className="text-sm text-muted-foreground">
                      {c.detail}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <div className="flex flex-col gap-10">
          <section className="flex flex-col gap-3">
            <Heading
              title="Newest accounts"
              href="/admin/members"
              more="All members"
            />
            <ul className={`${FRAME} flex flex-col divide-y`}>
              {recentPeople.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                  <UserAvatar name={p.name} image={p.image} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{p.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {p.email}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {p.status === "pending"
                      ? "Waiting"
                      : p.status === "rejected"
                        ? "Declined"
                        : date.format(p.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="flex flex-col gap-3">
            <Heading
              title="Newest public links"
              href="/admin/sharing/links"
              more="All links"
            />
            {recentLinks.length === 0 ? (
              <p className="rounded-xl border border-dashed border-input px-4 py-8 text-center text-sm text-muted-foreground">
                No public links yet.
              </p>
            ) : (
              <ul className={`${FRAME} flex flex-col divide-y`}>
                {recentLinks.map((l) => (
                  <li
                    key={l.id}
                    className="flex items-center gap-3 px-4 py-2.5 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate">“{l.item}”</span>
                    <span className="truncate text-muted-foreground">
                      {l.owner}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {date.format(l.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </AdminPage>
  )
}
