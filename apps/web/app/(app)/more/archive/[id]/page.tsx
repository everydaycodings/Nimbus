import { notFound } from "next/navigation"

import { Viewer } from "@/components/archive/viewer"
import { getPage, listCookies } from "@/lib/archive/run"
import { requireMember } from "@/lib/session"
import { UUID } from "@/lib/file-rules"

export const metadata = { title: "Saved page · Website archive · Nimbus" }

export default async function ArchivedPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ s?: string; tab?: string }> }) {
  const me = await requireMember()
  const { id } = await params
  const { s, tab } = await searchParams
  const found = UUID.test(id) ? await getPage(me.id, id) : null
  if (!found) notFound()
  const snapshot = found.snapshots.find((x) => x.id === s) ?? found.snapshots[0] ?? null
  const view = tab === "pdf" || tab === "png" || tab === "text" ? tab : "html"
  return <Viewer page={found.page} snapshots={found.snapshots} snapshot={snapshot} view={view} cookies={(await listCookies(me.id)).map((c) => c.domain)} />
}
