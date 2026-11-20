import { notFound } from "next/navigation"

import { ToolCard } from "@/components/more/tool-card"
import { MORE_GROUPS, moreTools } from "@/lib/more-tools"
import { isAdmin, requireMember } from "@/lib/session"
import { getSettings } from "@/lib/signup"

export const metadata = { title: "More · Nimbus" }
export const dynamic = "force-dynamic"

export default async function MorePage() {
  const me = await requireMember()
  const s = await getSettings()
  const tools = moreTools(s).filter((t) => t.id !== "server-backup" || s.serverBackupMembers || isAdmin(me.role))
  if (tools.length === 0) notFound()
  const now = Date.now()
  const cards = await Promise.all(tools.map(async (t) => ({ t, status: (await t.status?.(me.id, now)) ?? null })))
  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">More</h1>
        <p className="text-sm text-pretty text-muted-foreground">Extra tools that run alongside your files.</p>
      </div>
      {MORE_GROUPS.map(([group, title]) => {
        const items = cards.filter(({ t }) => t.group === group)
        return (
          items.length > 0 && (
            <section key={group} aria-labelledby={`more-${group}`} className="flex flex-col gap-3">
              <h2 id={`more-${group}`} className="text-sm font-medium text-muted-foreground">{title}</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {items.map(({ t, status }) => (
                  <ToolCard key={t.id} tool={t} status={status} />
                ))}
              </div>
            </section>
          )
        )
      })}
    </div>
  )
}
