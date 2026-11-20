import { Finder } from "@/components/cleanup/finder"
import { TABS, type Tab } from "@/components/cleanup/tabs"
import { duplicates, largest, notOpened, nowMs, similar } from "@/lib/cleanup/finder"
import { unhashedCount } from "@/lib/cleanup/hash"
import { requireMember } from "@/lib/session"

export const metadata = { title: "Clean up · Nimbus" }

const num = (v: string | undefined, fallback: number, min: number, max: number) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) && v ? Math.min(max, Math.max(min, n)) : fallback
}

export default async function CleanupPage({ searchParams }: { searchParams: Promise<{ tab?: string; months?: string; min?: string }> }) {
  const me = await requireMember()
  const q = await searchParams
  const months = num(q.months, 12, 1, 120)
  const minMb = num(q.min, 10, 1, 100_000)
  const [indexing, sim] = await Promise.all([unhashedCount(me.id), similar(me.id)])
  const asked = TABS.find(([t]) => t === q.tab)?.[0]
  const tab: Tab = asked === "similar" && !sim ? "duplicates" : (asked ?? "duplicates")
  const [groups, files] = await Promise.all([
    tab === "duplicates" ? duplicates(me.id) : tab === "similar" ? Promise.resolve(sim ?? []) : [],
    tab === "largest" ? largest(me.id, minMb * 1024 * 1024) : tab === "unopened" ? notOpened(me.id, months) : [],
  ])
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Clean up</h1>
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">
          Find files that take space for no reason. Only your own files count, and nothing leaves the trash until you empty it.
        </p>
      </header>
      <Finder key={`${tab}:${months}:${minMb}:${groups.reduce((n, g) => n + g.files.length, files.length)}`} tab={tab} groups={groups} files={files} months={months} minMb={minMb} indexing={indexing} hasSimilar={Boolean(sim)} now={nowMs()} />
    </div>
  )
}
