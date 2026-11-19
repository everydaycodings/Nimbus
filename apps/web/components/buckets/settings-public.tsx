"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useId, useState, useTransition } from "react"

import { setBucketPublic } from "@/app/(app)/buckets/actions"
import { CopyButton } from "@/components/copy-button"
import { Confirm, Heading, SECTION, Switch, TOUCH } from "@/components/registry-ui"
import { useNotice } from "@/components/toaster"
import { FormError } from "@/components/two-factor"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import type { BucketConfig } from "@/lib/s3api/bucket-config"

// Public read: anyone with the link can download, nobody can list.
export function SettingsPublic({ bucketId, c, admin }: { bucketId: string; c: BucketConfig; admin: boolean }) {
  const router = useRouter()
  const setNotice = useNotice()
  const id = useId()
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()
  const [asking, setAsking] = useState(false)
  const on = c.publicUrl !== null

  const change = (turnOn: boolean, regenerate: boolean, text: string) =>
    start(async () => {
      setError(undefined)
      const r = await setBucketPublic(bucketId, turnOn, regenerate)
      if (r.error) return setError(r.error)
      setAsking(false)
      setNotice({ text })
      router.refresh()
    })

  return (
    <section className={SECTION} aria-labelledby="public-heading">
      <Heading id="public-heading" title="Public access" hint="Share the files in this bucket with anyone, without an access key." />
      {!c.publicAllowed && !on ? (
        <div className="rounded-xl border border-dashed px-4 py-4 text-sm text-muted-foreground">
          An admin hasn’t allowed public buckets on this server.
          {admin && (
            <>
              {" "}
              <Link href="/admin/system/s3" className="rounded-sm text-foreground underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                Admin → S3 API
              </Link>
            </>
          )}
        </div>
      ) : (
        <div className="grid gap-4 rounded-xl border bg-card p-4">
          <div className="flex items-center gap-3">
            <Switch
              id={`${id}-public`}
              checked={on || asking}
              disabled={pending}
              onChange={(e) => (e.target.checked ? setAsking(true) : change(false, false, "Public access is off. The link stopped working."))}
            />
            <Label htmlFor={`${id}-public`} className="cursor-pointer">
              Anyone with the link can download files
            </Label>
          </div>
          {!c.publicAllowed && <p className="text-sm text-muted-foreground">An admin has turned public buckets off, so the link doesn’t work right now.</p>}
          {asking && !on && (
            <div role="alertdialog" aria-labelledby={`${id}-warn`} className="grid gap-3 rounded-lg border border-destructive/40 p-3">
              <p id={`${id}-warn`} className="text-sm text-pretty">
                <strong>Anyone with the link can download any file in this bucket.</strong> Listing stays off, but a link to one file works for anyone who has it.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="destructive" size="sm" className={TOUCH} disabled={pending} onClick={() => change(true, false, "This bucket is public.")}>
                  Make public
                </Button>
                <Button type="button" variant="ghost" size="sm" className={TOUCH} autoFocus disabled={pending} onClick={() => setAsking(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
          {on && c.publicUrl && (
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <span className="text-sm font-medium">Public URL</span>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="min-w-0 flex-1 basis-64 rounded-md border bg-muted/40 px-2 py-1.5 font-mono text-xs break-all">{c.publicUrl}</code>
                  <CopyButton value={c.publicUrl} label="Copy public URL" className="pointer-coarse:h-11" />
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                A file’s link is this address plus its name, like <code className="font-mono text-xs break-all">{c.publicUrl}photos/cat.jpg</code>.
              </p>
              <div>
                <Confirm
                  label="Make a new link"
                  question="The old link stops working."
                  yes="Make new link"
                  danger={false}
                  pending={pending}
                  onYes={() => change(true, true, "Made a new link. The old one stopped working.")}
                />
              </div>
            </div>
          )}
          <FormError>{error}</FormError>
        </div>
      )}
    </section>
  )
}
