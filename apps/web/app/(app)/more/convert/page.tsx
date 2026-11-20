import { Shell } from "@/components/convert/shell"
import { listJobs, listPresets, listWatches, quotaOf } from "@/lib/convert/jobs"
import { requireMember } from "@/lib/session"

export const metadata = { title: "Media converter · Nimbus" }

export default async function ConvertPage() {
  const me = await requireMember()
  const [jobs, presets, watches, quota] = await Promise.all([listJobs(me.id), listPresets(me.id), listWatches(me.id), quotaOf(me.id)])
  return <Shell jobs={jobs} presets={presets} watches={watches} quota={quota} />
}
