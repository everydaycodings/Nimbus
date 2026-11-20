"use client"

import { CheckCircleIcon, GlobeIcon } from "@phosphor-icons/react"
import Link from "next/link"
import { useState, useTransition } from "react"

import { saveOne } from "@/app/(app)/more/archive/actions"
import { TOUCH } from "@/components/registry-ui"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

type Done = { id?: string; existing?: boolean }

export function AddOne({ url, ready }: { url: string | null; ready: boolean }) {
  const [tags, setTags] = useState("")
  const [done, setDone] = useState<Done>()
  const [error, setError] = useState<string>()
  const [pending, run] = useTransition()

  if (!url)
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Save a page</h1>
        <p role="alert" className="text-sm text-pretty text-destructive">That isn&apos;t a web address. Use the bookmarklet on a normal http or https page.</p>
        <Link href="/more/archive" className={cn(buttonVariants({ variant: "outline" }), TOUCH, "w-fit")}>Open the archive</Link>
      </div>
    )

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Save a page</h1>
      <div className="flex items-start gap-3 rounded-xl border bg-card p-4">
        <GlobeIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <p className="min-w-0 text-sm break-all text-pretty">{url}</p>
      </div>
      {done ? (
        <div className="grid gap-3">
          <p role="status" className="flex items-start gap-2 text-sm text-pretty">
            <CheckCircleIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
            {done.existing ? "That page was already in your library. It is being captured again." : "Saved. It is being captured now."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href={done.id ? `/more/archive/${done.id}` : "/more/archive"} className={cn(buttonVariants(), TOUCH)}>{done.id ? "See the page" : "Open the archive"}</Link>
            <Button variant="outline" className={TOUCH} onClick={() => window.close()}>Close this tab</Button>
          </div>
        </div>
      ) : (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            setError(undefined)
            run(async () => {
              const r = await saveOne(url, tags).catch((): { error: string; id?: undefined; existing?: undefined } => ({ error: "Couldn't save. Check your connection and try again." }))
              if (r.error) setError(r.error)
              else setDone(r)
            })
          }}
        >
          {!ready && <p role="alert" className="text-sm text-pretty text-destructive">The browser service isn&apos;t available, so the page can&apos;t be captured right now.</p>}
          <div className="grid gap-1.5">
            <Label htmlFor="one-tags">Tags (optional)</Label>
            <Input id="one-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="read later" />
          </div>
          {error && <p role="alert" className="text-sm text-pretty text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" className={TOUCH} disabled={pending || !ready}>{pending ? "Saving…" : "Save and capture"}</Button>
            <Link href="/more/archive" className={cn(buttonVariants({ variant: "outline" }), TOUCH)}>Cancel</Link>
          </div>
        </form>
      )}
    </div>
  )
}
