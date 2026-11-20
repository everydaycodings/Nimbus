import { PackageIcon } from "@phosphor-icons/react/dist/ssr"
import Link from "next/link"

import { Empty } from "@/components/empty-state"
import { TABS, type Tab } from "@/components/registry-tools/format"
import { Shell } from "@/components/registry-tools/shell"
import { buttonVariants } from "@/components/ui/button"
import { registryState } from "@/lib/registry/manage"
import { listMirrors, listRuns, listRules, repoOptions } from "@/lib/registry/tools"
import { requireMember } from "@/lib/session"

export const metadata = { title: "Registry tools · Nimbus" }

const WHY = {
  unset: "The container registry isn't set up on this server.",
  off: "An admin turned the container registry off.",
  disabled: "An admin turned the registry off for your account.",
  unclaimed: "Pick your registry name first. Rules and mirrors work on repos in your registry.",
}

export default async function RegistryToolsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const me = await requireMember()
  const state = await registryState(me.id)
  if (state !== "ready")
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">Registry tools</h1>
        <Empty icon={PackageIcon} title="The registry isn't available to you yet">
          {WHY[state]}
          {state === "unclaimed" && (
            <Link href="/registry" className={buttonVariants({ variant: "outline" })}>
              Open Registry
            </Link>
          )}
        </Empty>
      </div>
    )
  const q = await searchParams
  const tab: Tab = TABS.some(([t]) => t === q.tab) ? (q.tab as Tab) : "rules"
  const [rules, mirrors, runs, repos] = await Promise.all([
    tab === "rules" ? listRules(me.id) : [],
    tab === "mirrors" ? listMirrors(me.id) : [],
    tab === "history" ? listRuns(me.id) : [],
    tab === "history" ? [] : repoOptions(me.id),
  ])
  return <Shell tab={tab} rules={rules} mirrors={mirrors} runs={runs} repos={repos} />
}
