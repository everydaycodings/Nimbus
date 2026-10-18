import {
  LinkSimpleIcon,
  LockSimpleIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react/dist/ssr"
import { desc, eq, isNotNull, sql } from "drizzle-orm"

import { SubmitButton } from "@/components/submit-button"
import { Badge } from "@/components/ui/badge"
import { db } from "@/lib/db"
import { nodes, shares, user } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/session"
import { getSettings } from "@/lib/signup"
import { revokeLink } from "./actions"

export const metadata = { title: "Public links · Admin · Nimbus" }

const date = new Intl.DateTimeFormat("en", { dateStyle: "medium" })

// Every public link on the instance, without a way in: admins see what's
// shared and can revoke it, not open it.
export default async function LinksPage() {
  await requireAdmin()
  const { publicLinksEnabled } = await getSettings()
  const links = await db
    .select({
      id: shares.id,
      name: shares.name,
      item: nodes.name,
      kind: nodes.kind,
      owner: user.name,
      ownerEmail: user.email,
      createdAt: shares.createdAt,
      expiresAt: shares.expiresAt,
      password: sql<boolean>`${shares.passwordHash} is not null`,
      upload: shares.allowUpload,
      views: shares.viewCount,
      downloads: shares.downloadCount,
    })
    .from(shares)
    .innerJoin(nodes, eq(nodes.id, shares.nodeId))
    .innerJoin(user, eq(user.id, nodes.ownerId))
    .where(isNotNull(shares.token))
    .orderBy(desc(shares.createdAt))
  const now = new Date()

  return (
    <div className="flex flex-col gap-4">
      {!publicLinksEnabled && (
        <p className="rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">
          Public links are turned off in Settings, so none of these open right
          now.
        </p>
      )}
      {links.length === 0 ? (
        <p className="rounded-xl border border-dashed border-input px-6 py-12 text-center text-sm text-muted-foreground">
          No one has made a public link yet.
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border bg-card shadow-sm">
          {links.map((l) => {
            const expired = l.expiresAt && l.expiresAt < now
            return (
              <li
                key={l.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                  <LinkSimpleIcon className="size-4" />
                </span>
                <div className="min-w-0 flex-1 basis-56">
                  <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                    <span className="truncate">“{l.item}”</span>
                    <span className="shrink-0 font-normal text-muted-foreground">
                      · {l.name}
                    </span>
                  </p>
                  <p className="truncate text-sm text-muted-foreground">
                    {l.owner} ({l.ownerEmail})
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  {l.password && (
                    <Badge variant="outline">
                      <LockSimpleIcon />
                      Password
                    </Badge>
                  )}
                  {l.upload && (
                    <Badge variant="outline">
                      <UploadSimpleIcon />
                      Uploads
                    </Badge>
                  )}
                  <span className="tabular-nums">
                    {l.views} views · {l.downloads} downloads
                  </span>
                  <span className={expired ? "text-destructive" : undefined}>
                    {l.expiresAt
                      ? `${expired ? "Expired" : "Expires"} ${date.format(l.expiresAt)}`
                      : "No expiry"}
                  </span>
                  <span className="tabular-nums">
                    Made {date.format(l.createdAt)}
                  </span>
                </div>
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
    </div>
  )
}
