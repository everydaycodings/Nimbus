import { ShieldCheckIcon } from "@phosphor-icons/react/dist/ssr"
import { and, desc, eq, ilike, or } from "drizzle-orm"
import Link from "next/link"

import { AdminPage, FRAME, SELECT } from "@/components/admin/setting"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { UserAvatar } from "@/components/user-avatar"
import { db } from "@/lib/db"
import { user } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/session"
import { formatBytes } from "@/lib/file-rules"
import { usedByOwner } from "@/lib/quota"
import { getSettings } from "@/lib/signup"
import { cn } from "@/lib/utils"
import { vaultsByOwner } from "@/lib/vault"
import { MemberActions } from "./member-actions"

const ROLE_LABEL = { owner: "Owner", admin: "Admin", member: "Member" }

const joined = new Intl.DateTimeFormat("en", { dateStyle: "medium" })

const storageLabel = (used: number, quota: number | null) =>
  quota === null
    ? `${formatBytes(used)} used`
    : `${formatBytes(used)} of ${formatBytes(quota)}`

function vaultLabel(vaults: { bytes: number }[]) {
  if (!vaults.length) return null
  const bytes = vaults.reduce((n, v) => n + v.bytes, 0)
  return ` · ${vaults.length} vault${vaults.length === 1 ? "" : "s"} (${formatBytes(bytes)})`
}

export const metadata = { title: "Members · Admin · Nimbus" }

const SORTS = {
  joined: "Newest first",
  name: "Name",
  storage: "Most storage",
} as const

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; sort?: string }>
}) {
  const me = await requireAdmin()
  const params = await searchParams
  const q = (params.q ?? "").trim()
  const declined = params.status === "rejected"
  const sort =
    (params.sort ?? "joined") in SORTS
      ? (params.sort as keyof typeof SORTS)
      : "joined"

  const settings = await getSettings()
  const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`
  const people = await db
    .select()
    .from(user)
    .where(
      and(
        eq(user.status, declined ? "rejected" : "active"),
        q ? or(ilike(user.name, like), ilike(user.email, like)) : undefined
      )
    )
    .orderBy(desc(user.createdAt))
  const ids = people.map((p) => p.id)
  const [used, vaults] = declined
    ? [null, null]
    : await Promise.all([usedByOwner(ids), vaultsByOwner(ids)])
  if (sort === "name") people.sort((a, b) => a.name.localeCompare(b.name))
  if (sort === "storage" && used)
    people.sort((a, b) => (used.get(b.id) ?? 0) - (used.get(a.id) ?? 0))
  const filtered = Boolean(q) || declined

  return (
    <AdminPage
      wide
      title="Members"
      description="Everyone with access to this Nimbus. Change roles, storage and recovery from each row."
    >
      <form role="search" className="flex flex-wrap items-center gap-2">
        <Input
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Search by name or email"
          aria-label="Search members"
          className="max-w-xs flex-1 basis-56"
        />
        <select
          name="status"
          defaultValue={declined ? "rejected" : "active"}
          aria-label="Status"
          className={cn(SELECT, "w-auto")}
        >
          <option value="active">Active</option>
          <option value="rejected">Declined</option>
        </select>
        <select
          name="sort"
          defaultValue={sort}
          aria-label="Sort"
          className={cn(SELECT, "w-auto")}
        >
          {Object.entries(SORTS).map(([k, label]) => (
            <option key={k} value={k} disabled={declined && k === "storage"}>
              {label}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline">
          Apply
        </Button>
        <p className="ml-auto text-sm text-muted-foreground tabular-nums">
          {people.length} {declined ? "declined" : "member"}
          {people.length === 1 || declined ? "" : "s"}
        </p>
      </form>

      {people.length === 0 ? (
        <p className="rounded-xl border border-dashed border-input px-6 py-12 text-center text-sm text-muted-foreground">
          {q
            ? `No one matches “${q}”.`
            : declined
              ? "No declined requests."
              : "No active members."}
          {filtered && (
            <>
              {" "}
              <Link
                href="/admin/members"
                className="text-foreground underline underline-offset-4"
              >
                Show everyone
              </Link>
            </>
          )}
        </p>
      ) : (
        <ul className={`${FRAME} flex flex-col divide-y`}>
          {people.map((p) => {
            const self = p.id === me.id
            return (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3"
              >
                <UserAvatar name={p.name} image={p.image} />
                <div className="min-w-0 flex-1 basis-48">
                  <p className="truncate text-sm font-medium">
                    <Link
                      href={`/admin/members/${p.id}`}
                      className="rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      {p.name}
                    </Link>
                    {self && (
                      <span className="text-muted-foreground"> (you)</span>
                    )}
                  </p>
                  <p className="truncate text-sm text-muted-foreground">
                    {p.email}
                  </p>
                </div>
                {used && !declined && (
                  <p className="text-sm text-muted-foreground tabular-nums">
                    {storageLabel(
                      used.get(p.id) ?? 0,
                      p.role === "owner"
                        ? null
                        : (p.quotaBytes ?? settings.defaultQuotaBytes)
                    )}
                    {vaultLabel(vaults?.get(p.id) ?? [])}
                  </p>
                )}
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <Badge variant="outline">
                    {ROLE_LABEL[p.role as keyof typeof ROLE_LABEL]}
                  </Badge>
                  {p.twoFactorEnabled && (
                    <Badge variant="outline" title="Two-factor is on">
                      <ShieldCheckIcon weight="fill" className="text-brand" />
                      2FA
                    </Badge>
                  )}
                  <span className="tabular-nums">
                    Joined {joined.format(p.createdAt)}
                  </span>
                </div>
                <MemberActions
                  me={me}
                  p={p}
                  fallback={settings.defaultQuotaBytes}
                  vaults={vaults?.get(p.id) ?? []}
                />
              </li>
            )
          })}
        </ul>
      )}
    </AdminPage>
  )
}
