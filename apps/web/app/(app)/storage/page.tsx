import { StorageMeter } from "@/components/storage-meter"
import { StorageReport } from "@/components/storage-report"
import { pageUserId } from "@/lib/files"
import { report } from "@/lib/storage-report"

export const metadata = { title: "Storage · Nimbus" }

export default async function StoragePage({
  searchParams,
}: {
  searchParams: Promise<{ folder?: string }>
}) {
  const me = await pageUserId()
  const { folder } = await searchParams
  const r = await report(me, typeof folder === "string" ? folder : null)

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Storage</h1>
        <p className="text-sm text-muted-foreground">
          What&apos;s using your space: big files, older versions, the trash and
          each folder.
        </p>
      </div>
      <div className="rounded-xl border bg-card px-2 py-3">
        <StorageMeter usage={r.usage} />
      </div>
      <StorageReport report={r} base="/storage" />
    </div>
  )
}
