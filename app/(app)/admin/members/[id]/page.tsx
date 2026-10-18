import {
  CheckCircleIcon,
  CircleIcon,
  LinkSimpleIcon,
  LockIcon,
} from "@phosphor-icons/react/dist/ssr"
import { and, desc, eq, gt, isNotNull, sql } from "drizzle-orm"
import { notFound } from "next/navigation"

import { AdminPage, FRAME } from "@/components/admin/setting"
import { SubmitButton } from "@/components/submit-button"
import { Badge } from "@/components/ui/badge"
import { UserAvatar } from "@/components/user-avatar"
import { db } from "@/lib/db"
import { account, nodes, session, shares, user } from "@/lib/db/schema"
import { formatBytes } from "@/lib/file-rules"
import { usedByOwner } from "@/lib/quota"
import { requireAdmin } from "@/lib/session"
import { getSettings } from "@/lib/signup"
import { vaultsByOwner } from "@/lib/vault"
import { revokeLink } from "../../actions"
import { MemberActions } from "../member-actions"

export const metadata = { title: "Member · Admin · Nimbus" }

const ROLE_LABEL = { owner: "Owner", admin: "Admin", member: "Member" }
const STATUS_LABEL = {
  active: "Active",
  pending: "Waiting",
  rejected: "Declined",
}
const PROVIDER_LABEL: Record<string, string> = {
  credential: "Email and password",
  google: "Google",
  github: "GitHub",
}

const day = new Intl.DateTimeFormat("en", { dateStyle: "medium" })
const moment = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
})

// "Firefox on Linux" from a user agent; good enough to tell sessions apart.
function device(ua: string | null) {
  if (!ua) return "Unknown device"
  const browser =
    [
      ["Edg/", "Edge"],
      ["Firefox/", "Firefox"],
      ["Chrome/", "Chrome"],
      ["Safari/", "Safari"],
    ].find(([k]) => ua.includes(k))?.[1] ?? "Browser"
  const os =
    [
      ["Android", "Android"],
      ["iPhone", "iPhone"],
      ["iPad", "iPad"],
      ["Windows", "Windows"],
      ["Mac OS", "macOS"],
      ["Linux", "Linux"],
    ].find(([k]) => ua.includes(k))?.[1] ?? "unknown system"
  return `${browser} on ${os}`
}

function Stat({
  label,
  value,
  note,
}: {
  label: string
  value: string
  note?: string
}) {
  return (
    <li className="grid content-start gap-1 px-4 py-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold tabular-nums">{value}</span>
      {note && (
        <span className="text-xs text-muted-foreground tabular-nums">
          {note}
        </span>
      )}
    </li>
  )
}

function Row({
  label,
  on,
  children,
}: {
  label: string
  on?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-1 px-4 py-3 sm:grid-cols-[12rem_1fr] sm:gap-6">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-2 text-sm">
        {on !== undefined &&
          (on ? (
            <CheckCircleIcon
              weight="fill"
              className="size-4 shrink-0 text-brand"
            />
          ) : (
            <CircleIcon className="size-4 shrink-0 text-muted-foreground" />
          ))}
        <span>{children}</span>
      </dd>
    </div>
  )
}

function Heading({ title, count }: { title: string; count?: number }) {
  return (
    <h2 className="text-base font-semibold">
      {title}
      {count !== undefined && (
        <span className="font-normal text-muted-foreground tabular-nums">
          {" "}
          {count}
        </span>
      )}
    </h2>
  )
}

export default async function MemberPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const me = await requireAdmin()
  const { id } = await params
  const [p] = await db.select().from(user).where(eq(user.id, id))
  if (!p) notFound()

  const [
    settings,
    used,
    vaultMap,
    [files],
    providers,
    sessions,
    links,
    [people],
  ] = await Promise.all([
    getSettings(),
    usedByOwner([id]),
    vaultsByOwner([id]),
    db
      .select({
        files: sql<number>`(count(*) filter (where ${nodes.kind} = 'file' and ${nodes.trashedAt} is null and ${nodes.vaultId} is null))::int`,
        folders: sql<number>`(count(*) filter (where ${nodes.kind} = 'folder' and ${nodes.trashedAt} is null and ${nodes.vaultId} is null))::int`,
        trashed: sql<number>`(count(*) filter (where ${nodes.trashedAt} is not null))::int`,
        trashedBytes: sql<number>`coalesce(sum(${nodes.size}) filter (where ${nodes.kind} = 'file' and ${nodes.trashedAt} is not null), 0)::float8`,
      })
      .from(nodes)
      .where(eq(nodes.ownerId, id)),
    db
      .select({ provider: account.providerId })
      .from(account)
      .where(eq(account.userId, id)),
    db
      .select({
        id: session.id,
        userAgent: session.userAgent,
        ip: session.ipAddress,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      })
      .from(session)
      .where(and(eq(session.userId, id), gt(session.expiresAt, sql`now()`)))
      .orderBy(desc(session.updatedAt)),
    db
      .select({
        id: shares.id,
        name: shares.name,
        item: nodes.name,
        expiresAt: shares.expiresAt,
        password: sql<boolean>`${shares.passwordHash} is not null`,
        views: shares.viewCount,
        downloads: shares.downloadCount,
      })
      .from(shares)
      .innerJoin(nodes, eq(nodes.id, shares.nodeId))
      .where(and(eq(nodes.ownerId, id), isNotNull(shares.token)))
      .orderBy(desc(shares.createdAt)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(shares)
      .innerJoin(nodes, eq(nodes.id, shares.nodeId))
      .where(
        and(
          eq(nodes.ownerId, id),
          sql`(${shares.granteeId} is not null or ${shares.granteeEmail} is not null)`
        )
      ),
  ])

  const vaults = vaultMap.get(id) ?? []
  const stored = used.get(id) ?? 0
  const quota =
    p.role === "owner" ? null : (p.quotaBytes ?? settings.defaultQuotaBytes)
  const now = new Date()
  const lastActive = sessions[0]?.updatedAt
  const password = providers.some((a) => a.provider === "credential")

  return (
    <AdminPage
      wide
      title={p.name}
      description={p.email}
      back={{ href: "/admin/members", label: "Members" }}
    >
      <div className="-mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        <UserAvatar name={p.name} image={p.image} size={40} />
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="outline">
            {ROLE_LABEL[p.role as keyof typeof ROLE_LABEL]}
          </Badge>
          <Badge variant={p.status === "active" ? "outline" : "secondary"}>
            {STATUS_LABEL[p.status as keyof typeof STATUS_LABEL]}
          </Badge>
          <span className="tabular-nums">Joined {day.format(p.createdAt)}</span>
          {p.id === me.id && <span>· This is you</span>}
        </div>
        <div className="ml-auto">
          <MemberActions
            me={me}
            p={p}
            fallback={settings.defaultQuotaBytes}
            vaults={vaults}
          />
        </div>
      </div>

      <ul
        className={`${FRAME} grid grid-cols-2 divide-y sm:grid-cols-3 sm:divide-y-0 lg:grid-cols-6`}
      >
        <Stat
          label="Storage"
          value={formatBytes(stored)}
          note={
            quota === null
              ? "No limit"
              : `of ${formatBytes(quota)} · ${Math.min(100, Math.round((stored / quota) * 100))}%`
          }
        />
        <Stat label="Files" value={files.files.toLocaleString("en")} />
        <Stat label="Folders" value={files.folders.toLocaleString("en")} />
        <Stat
          label="In trash"
          value={files.trashed.toLocaleString("en")}
          note={formatBytes(files.trashedBytes)}
        />
        <Stat
          label="Shared"
          value={(people.n + links.length).toLocaleString("en")}
          note={`${people.n} with people · ${links.length} link${links.length === 1 ? "" : "s"}`}
        />
        <Stat
          label="Vaults"
          value={vaults.length.toLocaleString("en")}
          note={
            vaults.length
              ? formatBytes(vaults.reduce((n, v) => n + v.bytes, 0))
              : undefined
          }
        />
      </ul>

      <div className="grid gap-10 lg:grid-cols-2">
        <section className="flex flex-col gap-3">
          <Heading title="Security" />
          <dl className={`${FRAME} divide-y`}>
            <Row label="Signs in with">
              {providers.length
                ? providers
                    .map((a) => PROVIDER_LABEL[a.provider] ?? a.provider)
                    .join(", ")
                : "No sign-in method"}
            </Row>
            <Row label="Two-factor" on={Boolean(p.twoFactorEnabled)}>
              {p.twoFactorEnabled
                ? "On"
                : password
                  ? settings.require2fa
                    ? "Off, they'll be asked to set it up"
                    : "Off"
                  : "Not used, signs in with a provider"}
            </Row>
            <Row label="Email confirmed" on={p.emailVerified}>
              {p.emailVerified ? "Yes" : "Not yet"}
            </Row>
            {password && (
              <Row label="Password" on={!p.passwordTemporary}>
                {p.passwordTemporary
                  ? "Temporary, set by an admin. They must change it."
                  : "Chosen by them"}
              </Row>
            )}
            <Row label="Last active">
              {lastActive ? moment.format(lastActive) : "No active sessions"}
            </Row>
          </dl>
        </section>

        <section className="flex flex-col gap-3">
          <Heading title="Signed-in devices" count={sessions.length} />
          {sessions.length === 0 ? (
            <p className="rounded-xl border border-dashed border-input px-4 py-8 text-center text-sm text-muted-foreground">
              Not signed in anywhere right now.
            </p>
          ) : (
            <ul className={`${FRAME} flex flex-col divide-y`}>
              {sessions.map((s) => (
                <li key={s.id} className="grid gap-0.5 px-4 py-3">
                  <span className="text-sm">{device(s.userAgent)}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {s.ip && !/^[0:.]*$/.test(s.ip) && `${s.ip} · `}Active{" "}
                    {moment.format(s.updatedAt)} · Signed in{" "}
                    {day.format(s.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid gap-10 lg:grid-cols-2">
        <section className="flex flex-col gap-3">
          <Heading title="Public links" count={links.length} />
          {links.length === 0 ? (
            <p className="rounded-xl border border-dashed border-input px-4 py-8 text-center text-sm text-muted-foreground">
              No public links.
            </p>
          ) : (
            <ul className={`${FRAME} flex flex-col divide-y`}>
              {links.map((l) => {
                const expired = l.expiresAt && l.expiresAt < now
                return (
                  <li key={l.id} className="flex items-center gap-3 px-4 py-3">
                    <LinkSimpleIcon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="truncate text-sm">
                        “{l.item}”
                        <span className="text-muted-foreground">
                          {" "}
                          · {l.name}
                        </span>
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {l.password && "Password · "}
                        {l.views} views · {l.downloads} downloads ·{" "}
                        <span
                          className={expired ? "text-destructive" : undefined}
                        >
                          {l.expiresAt
                            ? `${expired ? "Expired" : "Expires"} ${day.format(l.expiresAt)}`
                            : "No expiry"}
                        </span>
                      </span>
                    </span>
                    <form action={revokeLink.bind(null, l.id)}>
                      <SubmitButton size="sm" variant="destructive">
                        Revoke
                      </SubmitButton>
                    </form>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <Heading title="Vaults" count={vaults.length} />
          {vaults.length === 0 ? (
            <p className="rounded-xl border border-dashed border-input px-4 py-8 text-center text-sm text-muted-foreground">
              No vaults.
            </p>
          ) : (
            <ul className={`${FRAME} flex flex-col divide-y`}>
              {vaults.map((v) => (
                <li key={v.id} className="flex items-center gap-3 px-4 py-3">
                  <LockIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {v.name}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {v.items} file{v.items === 1 ? "" : "s"} ·{" "}
                    {formatBytes(v.bytes)} · Made{" "}
                    {day.format(new Date(v.createdAt))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AdminPage>
  )
}
