import { Shell } from "@/components/archive/shell"
import { browserStatus, defaultFolder, listCookies, listPages } from "@/lib/archive/run"
import { isAdmin, requireMember } from "@/lib/session"
import { appUrl } from "@/lib/email"

export const metadata = { title: "Website archive · Nimbus" }

export default async function ArchivePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const me = await requireMember()
  const { tab } = await searchParams
  const [pages, browser, folder, cookies] = await Promise.all([listPages(me.id), browserStatus(), defaultFolder(me.id), listCookies(me.id)])
  return <Shell pages={pages} browser={browser} admin={isAdmin(me.role)} tab={tab === "settings" ? "settings" : "library"} folder={folder} cookies={cookies} appUrl={appUrl("")} />
}
