"use client"

import { useState } from "react"

import { KeyDialog, type Made } from "@/components/buckets/key-dialog"
import { KeyReveal } from "@/components/buckets/key-reveal"
import type { BucketRow } from "@/lib/s3api/manage"

// The key form, then the one-time reveal of its secret.
export function NewKey({
  open,
  buckets,
  preset,
  url,
  region,
  onClose,
}: {
  open: boolean
  buckets: BucketRow[]
  preset?: string | null
  url: string
  region: string
  onClose: () => void
}) {
  const [made, setMade] = useState<Made | null>(null)
  return (
    <>
      <KeyDialog
        open={open && !made}
        editing={null}
        preset={preset}
        buckets={buckets}
        onClose={onClose}
        onMade={setMade}
      />
      <KeyReveal
        made={made}
        url={url}
        region={region}
        onDone={() => {
          setMade(null)
          onClose()
        }}
      />
    </>
  )
}
