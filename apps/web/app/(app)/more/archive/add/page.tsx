import { AddOne } from "@/components/archive/add-one"
import { cleanUrl } from "@/lib/archive/rules"
import { browserStatus } from "@/lib/archive/run"
import { requireMember } from "@/lib/session"

export const metadata = { title: "Save a page · Website archive · Nimbus" }

// Where the bookmarklet lands: /more/archive/add?url=… confirms before saving, so a link can't add pages by itself.
export default async function AddPage({ searchParams }: { searchParams: Promise<{ url?: string }> }) {
  await requireMember()
  const { url } = await searchParams
  return <AddOne url={cleanUrl(url ?? "")} ready={(await browserStatus()) === "ok"} />
}
