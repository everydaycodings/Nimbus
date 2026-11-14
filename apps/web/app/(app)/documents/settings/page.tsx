import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr"
import Link from "next/link"
import { notFound } from "next/navigation"

import { DocumentsSettings } from "@/components/documents-settings"
import * as docs from "@/lib/services/documents"
import { requireMember } from "@/lib/session"
import { getSettings } from "@/lib/signup"

export const metadata = { title: "Document settings · Nimbus" }

export default async function DocumentSettingsPage() {
  const me = await requireMember()
  if (!(await getSettings()).documentsEnabled) notFound()
  const [types, senders, watch, ignored] = await Promise.all([
    docs.listTypes(me),
    docs.listSenders(me),
    docs.listWatch(me),
    docs.listWatch(me, true),
  ])
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <Link
          href="/documents"
          className="mb-2 inline-flex items-center gap-1 rounded text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <ArrowLeftIcon className="size-3.5" />
          Documents
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          Document settings
        </h1>
        <p className="text-sm text-muted-foreground">
          How Nimbus sorts and reminds you about your documents.
        </p>
      </div>
      <DocumentsSettings types={types} senders={senders} watch={watch} ignored={ignored} />
    </div>
  )
}
