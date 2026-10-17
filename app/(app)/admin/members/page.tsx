import { desc, eq } from "drizzle-orm"
import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { UserAvatar } from "@/components/user-avatar"
import { db } from "@/lib/db"
import { user, type Status } from "@/lib/db/schema"
import { cn } from "@/lib/utils"
import { requireAdmin } from "@/lib/session"
import { setRole, setStatus } from "./actions"

const TABS: { status: Status; label: string; empty: string }[] = [
  {
    status: "pending",
    label: "Waiting",
    empty: "No one is waiting for approval.",
  },
  { status: "active", label: "Active", empty: "No active members." },
  { status: "rejected", label: "Declined", empty: "No declined requests." },
]

const ROLE_LABEL = { owner: "Owner", admin: "Admin", member: "Member" }

const joined = new Intl.DateTimeFormat("en", { dateStyle: "medium" })

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const me = await requireAdmin()
  const { tab } = await searchParams
  const current = TABS.find((t) => t.status === tab) ?? TABS[0]

  const people = await db
    .select()
    .from(user)
    .where(eq(user.status, current.status))
    .orderBy(desc(user.createdAt))

  return (
    <div className="flex flex-col gap-6">

      <nav
        aria-label="Member status"
        className="inline-flex h-9 w-fit items-center rounded-lg bg-muted p-[3px]"
      >
        {TABS.map((t) => (
          <Link
            key={t.status}
            href={`/admin/members?tab=${t.status}`}
            aria-current={t.status === current.status ? "page" : undefined}
            className={cn(
              "flex h-full items-center rounded-md border border-transparent px-3 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
              "aria-[current=page]:border-input aria-[current=page]:bg-input/30 aria-[current=page]:text-foreground aria-[current=page]:shadow-sm"
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {people.length === 0 ? (
        <p className="rounded-xl border border-dashed border-input px-6 py-12 text-center text-sm text-muted-foreground">
          {current.empty}
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border bg-card shadow-sm">
          {people.map((p) => {
            const self = p.id === me.id
            const locked = p.role === "owner" || self
            return (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3"
              >
                <UserAvatar name={p.name} image={p.image} />
                <div className="min-w-0 flex-1 basis-48">
                  <p className="truncate text-sm font-medium">
                    {p.name}
                    {self && (
                      <span className="text-muted-foreground"> (you)</span>
                    )}
                  </p>
                  <p className="truncate text-sm text-muted-foreground">
                    {p.email}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <Badge variant="outline">
                    {ROLE_LABEL[p.role as keyof typeof ROLE_LABEL]}
                  </Badge>
                  <span className="tabular-nums">
                    Joined {joined.format(p.createdAt)}
                  </span>
                </div>
                {!locked && (
                  <div className="flex gap-2">
                    {p.status !== "active" && (
                      <form action={setStatus.bind(null, p.id, "active")}>
                        <Button type="submit" size="sm">
                          Approve
                        </Button>
                      </form>
                    )}
                    {p.status !== "rejected" && (
                      <form action={setStatus.bind(null, p.id, "rejected")}>
                        <Button type="submit" size="sm" variant="destructive">
                          {p.status === "pending" ? "Decline" : "Remove access"}
                        </Button>
                      </form>
                    )}
                    {me.role === "owner" && p.status === "active" && (
                      <form
                        action={setRole.bind(
                          null,
                          p.id,
                          p.role === "admin" ? "member" : "admin"
                        )}
                      >
                        <Button type="submit" size="sm" variant="outline">
                          {p.role === "admin" ? "Make member" : "Make admin"}
                        </Button>
                      </form>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
