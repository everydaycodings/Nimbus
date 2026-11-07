import {
  CloudIcon,
  ClockIcon,
  LinkBreakIcon,
  ProhibitIcon,
} from "@phosphor-icons/react/dist/ssr"
import type { Metadata } from "next"
import Link from "next/link"

import { unlockTransfer } from "@/app/t/actions"
import { PasswordGate } from "@/components/public-link"
import { TransferView } from "@/components/transfer-view"
import type { Item } from "@/lib/files"
import { getSession } from "@/lib/session"
import {
  filesOf,
  findTransfer,
  inVisit,
  logEvent,
  unlocked,
} from "@/lib/transfer-links"

type Props = { params: Promise<{ token: string }> }

export const metadata: Metadata = {
  title: "Sent to you · Nimbus",
  robots: { index: false, follow: false },
}

const daysLeft = (at: Date) => Math.ceil((at.getTime() - Date.now()) / 86_400_000)

function Notice({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof LinkBreakIcon
  title: string
  children: React.ReactNode
}) {
  return (
    <Shell>
      <div className="mx-auto flex max-w-sm flex-col items-center gap-3 py-24 text-center">
        <Icon className="size-10 text-muted-foreground" />
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{children}</p>
      </div>
    </Shell>
  )
}

export default async function TransferPage({ params }: Props) {
  const { token } = await params
  const t = await findTransfer(token)

  if (!t)
    return (
      <Notice icon={LinkBreakIcon} title="This link doesn't work">
        It may have expired or been turned off. Ask the person who sent it for
        a new one.
      </Notice>
    )

  if (!(await unlocked(t)))
    return (
      <Shell>
        <div className="py-16">
          <PasswordGate token={token} unlock={unlockTransfer} />
        </div>
      </Shell>
    )

  if (t.closed && !(await inVisit(t)))
    return (
      <Notice icon={ProhibitIcon} title="This transfer is closed">
        It has been downloaded as many times as {t.senderName || "the sender"}{" "}
        allowed. Ask them to send it again.
      </Notice>
    )

  await logEvent(t.recipientId, "view")
  const [files, session] = await Promise.all([filesOf(t.id), getSession()])
  // Visitors see files only, never the sender's tags or shares.
  const items: Item[] = files.map((f) => ({
    id: f.id,
    kind: "file",
    name: f.name,
    size: f.size,
    mime: f.mime,
    starred: false,
    updatedAt: f.createdAt.toISOString(),
    trashedAt: null,
    tags: [],
    version: f.id,
    thumb: f.thumb ? "1" : "",
    sharedWithPeople: false,
    hasLink: false,
  }))
  const sender = t.senderName || t.senderEmail
  const days = daysLeft(t.expiresAt)

  return (
    <Shell by={`From ${sender}`}>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t.title || `${sender} sent you files`}
          </h1>
          {t.message && (
            <p className="whitespace-pre-line text-sm">{t.message}</p>
          )}
          <p
            className="flex items-center gap-1 text-xs text-muted-foreground"
            title={t.expiresAt.toLocaleString()}
          >
            <ClockIcon className="size-3.5" />
            Available for {days <= 1 ? "less than a day" : `${days} more days`}
          </p>
        </div>
        <TransferView token={token} items={items} signedIn={Boolean(session)} />
      </div>
    </Shell>
  )
}

function Shell({ by, children }: { by?: string; children: React.ReactNode }) {
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
        {by && (
          <span className="ml-auto truncate text-sm text-muted-foreground">
            {by}
          </span>
        )}
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col p-4 sm:p-6 lg:p-10">
        {children}
      </main>
    </div>
  )
}
