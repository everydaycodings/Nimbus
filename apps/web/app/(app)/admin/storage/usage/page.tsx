import Link from "next/link"

import { AdminPage, FRAME } from "@/components/admin/setting"
import { UserAvatar } from "@/components/user-avatar"
import { formatBytes } from "@/lib/file-rules"
import { requireAdmin } from "@/lib/session"
import { instanceUsage } from "@/lib/storage-report"
import { cn } from "@/lib/utils"

export const metadata = { title: "Usage · Admin · Nimbus" }

const KINDS = [
  { key: "images", label: "Images", fill: "bg-file-image" },
  { key: "videos", label: "Videos", fill: "bg-file-video" },
  { key: "docs", label: "Docs", fill: "bg-file-doc" },
  { key: "other", label: "Other", fill: "bg-file-archive" },
  { key: "vault", label: "Vault", fill: "bg-foreground/70" },
  { key: "extra", label: "Versions & trash", fill: "bg-muted-foreground" },
] as const

export default async function UsagePage() {
  await requireAdmin()
  const rows = await instanceUsage()
  const total = (k: (typeof KINDS)[number]["key"] | "used") =>
    rows.reduce((n, r) => n + r.usage[k], 0)
  const used = total("used")

  return (
    <AdminPage
      wide
      title="Usage"
      description="Who stores what, fullest first against their limit. Open someone to see what fills their space."
    >
      <section aria-label="Totals" className="flex flex-col gap-3">
        <ul
          className={`${FRAME} grid grid-cols-2 divide-y sm:grid-cols-4 sm:divide-y-0 lg:grid-cols-7`}
        >
          <li className="grid content-start gap-1 px-4 py-3">
            <span className="text-xs text-muted-foreground">Stored</span>
            <span className="text-lg font-semibold tabular-nums">
              {formatBytes(used)}
            </span>
          </li>
          {KINDS.map((k) => (
            <li key={k.key} className="grid content-start gap-1 px-4 py-3">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  aria-hidden
                  className={cn("size-2 shrink-0 rounded-full", k.fill)}
                />
                {k.label}
              </span>
              <span className="text-lg font-semibold tabular-nums">
                {formatBytes(total(k.key))}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <ul className={`${FRAME} flex flex-col divide-y`}>
        {rows.map((p) => {
          const { used, quota } = p.usage
          const share = quota ? Math.min(1, used / quota) : null
          return (
            <li key={p.id}>
              <Link
                href={`/admin/members/${p.id}/storage`}
                className="flex items-center gap-3 px-4 py-3 outline-none hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
              >
                <UserAvatar name={p.name} image={p.image} size={32} />
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="truncate text-sm font-medium">{p.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {p.email}
                  </span>
                </span>
                <span className="hidden w-40 sm:block">
                  {share !== null && (
                    <span
                      aria-hidden
                      className="block h-1.5 overflow-hidden rounded-full bg-muted"
                    >
                      <span
                        className={cn(
                          "block h-full",
                          share >= 0.9 ? "bg-destructive" : "bg-brand"
                        )}
                        style={{ width: `${Math.max(1, share * 100)}%` }}
                      />
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    "w-36 shrink-0 text-right text-sm tabular-nums",
                    share !== null && share >= 0.9
                      ? "text-destructive"
                      : "text-muted-foreground"
                  )}
                >
                  {quota === null
                    ? `${formatBytes(used)} · no limit`
                    : `${formatBytes(used)} of ${formatBytes(quota)}`}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </AdminPage>
  )
}
