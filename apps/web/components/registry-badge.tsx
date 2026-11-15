"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import { newBadgeToken } from "@/app/(app)/registry/build-actions"
import { CopyButton } from "@/components/copy-button"
import { Code, Confirm, Heading, SECTION, TOUCH } from "@/components/registry-ui"
import { FormError } from "@/components/two-factor"
import { Button } from "@/components/ui/button"

// The README badge: a public repository needs nothing in the URL, a private one carries a secret token.
export function StatusBadge({ repoId, base, name, isPublic, token, canAdmin }: { repoId: string; base: string; name: string; isPublic: boolean; token: string | null; canAdmin: boolean }) {
  const router = useRouter()
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()
  const ready = isPublic || token
  const image = `${base}/api/registry/badge/${name}.svg${isPublic ? "" : `?token=${token}`}`
  const markdown = `[![build](${image})](${base}/registry/${name})`
  const make = () =>
    start(async () => {
      setError(undefined)
      const r = await newBadgeToken(repoId)
      if (r.error) setError(r.error)
      else router.refresh()
    })
  return (
    <section className={SECTION} aria-labelledby="badge-heading">
      <Heading id="badge-heading" title="Status badge" hint="Shows whether the latest build passes, for a README. Add ?tag=v1 to follow one tag." />
      <div className="grid gap-3 rounded-xl border bg-card p-4">
        {ready ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image} alt="Build status badge" height={20} className="h-5 w-fit" />
            <div className="relative">
              <Code copy>{markdown}</Code>
              <div className="absolute top-2 right-2">
                <CopyButton value={markdown} label="Copy the Markdown" className={TOUCH} />
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-pretty text-muted-foreground">
            This repository is private, so its badge link carries a secret. {canAdmin ? "Anyone with the link sees the build status, nothing else." : "A repository admin can create it."}
          </p>
        )}
        {!isPublic && canAdmin && (
          <div className="flex flex-wrap items-center gap-2">
            {token ? (
              <Confirm label="Make a new link" question="The old link stops working." yes="Make a new link" danger={false} pending={pending} onYes={make} />
            ) : (
              <Button type="button" className={TOUCH} disabled={pending} onClick={make}>
                Create the badge link
              </Button>
            )}
          </div>
        )}
        <FormError>{error}</FormError>
      </div>
    </section>
  )
}
