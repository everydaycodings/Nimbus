import { ArrowLeftIcon } from "@phosphor-icons/react/ssr"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { headers } from "next/headers"
import Link from "next/link"

import { ApproveBox, Devices, Downloads } from "@/components/secrets/device-panel"
import { GuideDoc, headings } from "@/components/secrets/guide-doc"
import { listBinaries, listNodeFiles } from "@/lib/secrets/cli-files"
import { pageUnlocked } from "@/lib/secrets/page"
import { listCliTokens, lookupDevice, tokenPolicy } from "@/lib/secrets/tokens"

export const metadata = { title: "Connect your apps · Secrets · Nimbus" }

// The same text as docs/secrets.md, with this server's address in the examples.
const SAMPLE = "https://nimbus.example.com"

export default async function ConnectPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const me = await pageUnlocked()
  if (!me) return null
  const { code } = await searchParams
  const h = await headers()
  const server = (
    process.env.BETTER_AUTH_URL ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`
  ).replace(/\/+$/, "")
  const [pol, binaries, tokens, device, raw] = await Promise.all([
    tokenPolicy(),
    Promise.all([listNodeFiles(), listBinaries()]).then((l) => l.flat()),
    listCliTokens(me.id),
    code ? lookupDevice(code) : null,
    readFile(path.join(process.cwd(), "content", "secrets-guide.md"), "utf8"),
  ])
  const md = raw.replaceAll(SAMPLE, server)
  const toc = headings(md)
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href="/secrets" className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-3.5" />
          All projects
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Connect your apps</h1>
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">
          Every way to get a secret out of Nimbus and into a program, server or pipeline.
        </p>
      </div>

      {!pol.cli && (
        <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          An admin turned the command line off on this server. Sign-ins and downloads are paused.
        </p>
      )}
      {code && pol.cli && <ApproveBox code={code} device={device} />}

      <div className="grid min-w-0 gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="On this page" className="lg:sticky lg:top-6 lg:max-h-[calc(100dvh-4rem)] lg:self-start lg:overflow-y-auto">
          <details className="group rounded-lg border lg:hidden">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium">On this page</summary>
            <Toc toc={toc} className="border-t p-2" />
          </details>
          <Toc toc={toc} className="hidden lg:flex" />
        </nav>
        <article className="min-w-0 max-w-3xl">
          <GuideDoc md={md} slots={{ downloads: <Downloads binaries={binaries} />, devices: <Devices tokens={tokens} /> }} />
        </article>
      </div>
    </div>
  )
}

function Toc({ toc, className }: { toc: ReturnType<typeof headings>; className: string }) {
  return (
    <ul className={`flex flex-col gap-0.5 text-sm ${className}`}>
      {toc.map((t) => (
        <li key={t.id}>
          <a
            href={`#${t.id}`}
            className={
              t.depth === 2
                ? "block rounded px-2 py-1 font-medium hover:bg-muted"
                : "block rounded py-0.5 pr-2 pl-5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            }
          >
            {t.text}
          </a>
        </li>
      ))}
    </ul>
  )
}
