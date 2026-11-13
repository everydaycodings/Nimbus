import { headers } from "next/headers"

import { CliPanel } from "@/components/secrets/cli-panel"
import { listBinaries } from "@/lib/secrets/cli-files"
import { pageUnlocked } from "@/lib/secrets/page"
import { listCliTokens, lookupDevice, tokenPolicy } from "@/lib/secrets/tokens"

export const metadata = { title: "Command line · Secrets · Nimbus" }

export default async function CliPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const me = await pageUnlocked()
  if (!me) return null
  const { code } = await searchParams
  const h = await headers()
  const server = (
    process.env.BETTER_AUTH_URL ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`
  ).replace(/\/+$/, "")
  const [pol, binaries, tokens, device] = await Promise.all([
    tokenPolicy(),
    listBinaries(),
    listCliTokens(me.id),
    code ? lookupDevice(code) : null,
  ])
  return (
    <CliPanel
      enabled={pol.cli}
      server={server}
      binaries={binaries}
      tokens={tokens}
      code={code ?? null}
      device={device}
    />
  )
}
