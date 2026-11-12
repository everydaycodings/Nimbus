import { HiddenList } from "@/components/hidden-memories"
import { listHides } from "@/lib/services/photos"
import { requireMember } from "@/lib/session"

export const metadata = { title: "Hidden from memories · Nimbus" }

export default async function HiddenPage() {
  return <HiddenList first={await listHides(await requireMember())} />
}
