"use client"

import { KeyIcon, PlusIcon } from "@phosphor-icons/react"
import { useState } from "react"

import { KeyTable } from "@/components/buckets/key-table"
import { NewKey } from "@/components/buckets/new-key"
import { Empty, Heading, SECTION } from "@/components/registry-ui"
import { Button } from "@/components/ui/button"
import type { BucketRow, KeyRow } from "@/lib/s3api/manage"

// The keys that open this bucket.
export function DetailAccess({ bucket, buckets, keys, atMax, url, region }: { bucket: BucketRow; buckets: BucketRow[]; keys: KeyRow[]; atMax: boolean; url: string; region: string }) {
  const [open, setOpen] = useState(false)
  return (
    <section className={SECTION} aria-labelledby="access-heading">
      <Heading
        id="access-heading"
        title="Access keys"
        hint="Keys that can reach this bucket: ones for all buckets and ones made for it. Expired keys are left out."
      >
        <Button onClick={() => setOpen(true)} disabled={atMax}>
          <PlusIcon />
          New key for this bucket
        </Button>
      </Heading>
      {keys.length === 0 ? (
        <Empty icon={KeyIcon} title="No keys reach this bucket">
          Make a key for it, then give the key to your app.
        </Empty>
      ) : (
        <KeyTable keys={keys} buckets={buckets} url={url} region={region} />
      )}
      <NewKey open={open} preset={bucket.id} buckets={buckets} url={url} region={region} onClose={() => setOpen(false)} />
    </section>
  )
}
