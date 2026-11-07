import { CloudIcon, LinkBreakIcon } from "@phosphor-icons/react/dist/ssr"
import type { Metadata } from "next"
import Link from "next/link"

import { VaultLinkView } from "@/components/vault-link-view"
import {
  countView,
  findVaultLink,
  linkVersionIds,
} from "@/lib/vault-links"

export const metadata: Metadata = {
  title: "Shared with you · Nimbus",
  robots: { index: false, follow: false },
  // The key sits in the URL's #, which browsers never send, but keep it out of any
  // Referer a preview or download might make anyway.
  referrer: "no-referrer",
}

// Names are in the sealed manifest only; the server renders none of them.
export default async function VaultLinkPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const link = await findVaultLink(token)
  if (link) await countView(link.id)
  const pass =
    link?.wrappedLinkKey && link.kdfSalt && link.kdfIterations && link.kdfMemory
      ? {
          salt: link.kdfSalt,
          t: link.kdfIterations,
          m: link.kdfMemory,
          wrapped: link.wrappedLinkKey,
        }
      : null

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="flex h-14 items-center gap-3 border-b px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-md text-sm font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <CloudIcon weight="fill" className="size-5 text-brand" />
          Nimbus
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col p-4 sm:p-6 lg:p-10">
        {link ? (
          <VaultLinkView
            token={token}
            manifest={link.manifest}
            kdf={pass}
            available={await linkVersionIds(link.id)}
          />
        ) : (
          <div className="mx-auto flex max-w-sm flex-col items-center gap-3 py-24 text-center">
            <LinkBreakIcon className="size-10 text-muted-foreground" />
            <h1 className="text-lg font-semibold">This link doesn&apos;t work</h1>
            <p className="text-sm text-muted-foreground">
              It may have expired or been revoked. Ask the person who sent it
              for a new one.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
