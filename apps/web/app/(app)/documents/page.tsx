import { notFound } from "next/navigation"
import { cookies } from "next/headers"

import { DocumentsView } from "@/components/documents-view"
import { readFilters, toQuery } from "@/lib/doc-filters"
import * as docs from "@/lib/services/documents"
import { requireMember } from "@/lib/session"
import { getSettings } from "@/lib/signup"

export const metadata = { title: "Documents · Nimbus" }

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const me = await requireMember()
  if (!(await getSettings()).documentsEnabled) notFound()
  const sp = await searchParams
  const filters = readFilters(sp)
  const open = typeof sp.open === "string" ? sp.open : null
  const [summary, types, senders, years, list, layout, totals, openDoc] =
    await Promise.all([
      docs.summary(me),
      docs.listTypes(me),
      docs.listSenders(me),
      docs.years(me),
      filters.tab === "totals"
        ? null
        : docs.listDocuments(me, toQuery(filters)),
      cookies().then((c) =>
        c.get("docs_view")?.value === "grid" ? "grid" : "list"
      ),
      filters.tab === "totals"
        ? docs.totals(me, {
            by: "sender",
            period: "month",
            ...(filters.year && { year: Number(filters.year) }),
          })
        : null,
      open && /^[0-9a-f-]{36}$/i.test(open) ? docs.getDocument(me, open) : null,
    ])
  return (
    <DocumentsView
      filters={filters}
      summary={summary}
      types={types}
      senders={senders}
      years={years}
      first={list}
      totals={totals}
      layout={layout}
      open={openDoc && (({ text, ...i }) => (void text, i))(openDoc)}
    />
  )
}
