"use client"

import { ArrowClockwiseIcon } from "@phosphor-icons/react"
import { useRouter } from "next/navigation"
import { useId, useState, useTransition } from "react"

import { captureNow, pickCookie, remove, retag, schedule } from "@/app/(app)/more/archive/actions"
import { Confirm, SELECT, TOUCH } from "@/components/registry-ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { PageView } from "@/lib/archive/run"
import { cn } from "@/lib/utils"
import { SCHEDULES } from "./format"

// Capture again, the schedule, tags, which saved cookies to send, and delete.
export function Controls({ page, cookies }: { page: PageView; cookies: string[] }) {
  const router = useRouter()
  const id = useId()
  const [tags, setTags] = useState(page.tags.join(", "))
  const [error, setError] = useState<string>()
  const [pending, run] = useTransition()
  const running = page.status === "running"

  const act = (f: () => Promise<{ error?: string }>) =>
    run(async () => {
      const r = await f().catch(() => ({ error: "Couldn't save. Check your connection and try again." }))
      setError(r.error)
      router.refresh()
    })

  return (
    <section aria-labelledby={`${id}-h`} className="flex flex-col gap-4 rounded-xl border bg-card p-4">
      <h2 id={`${id}-h`} className="sr-only">Page settings</h2>
      <Button className={TOUCH} disabled={pending || running} onClick={() => act(() => captureNow(page.id))}>
        <ArrowClockwiseIcon className={cn(running && "animate-spin motion-reduce:animate-none")} />
        {running ? "Capturing…" : "Capture again"}
      </Button>

      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-sched`}>Capture again automatically</Label>
        <select id={`${id}-sched`} value={page.intervalMin ? String(page.intervalMin) : ""} disabled={pending} onChange={(e) => act(() => schedule(page.id, e.target.value ? Number(e.target.value) : null))} className={cn(SELECT, "pointer-coarse:h-11")}>
          {SCHEDULES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
        <p className="text-xs text-pretty text-muted-foreground">A new version is kept only when the text changed.</p>
      </div>

      <form className="grid gap-1.5" onSubmit={(e) => { e.preventDefault(); act(() => retag(page.id, tags)) }}>
        <Label htmlFor={`${id}-tags`}>Tags</Label>
        <div className="flex gap-2">
          <Input id={`${id}-tags`} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="read later, recipes" />
          <Button type="submit" variant="outline" className={TOUCH} disabled={pending}>Save</Button>
        </div>
      </form>

      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-cookie`}>Cookies</Label>
        <select id={`${id}-cookie`} value={page.cookieDomain ?? ""} disabled={pending} onChange={(e) => act(() => pickCookie(page.id, e.target.value || null))} className={cn(SELECT, "pointer-coarse:h-11")}>
          <option value="">Match the site automatically</option>
          {cookies.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <p className="text-xs text-pretty text-muted-foreground">Saved cookies are managed in the archive&apos;s Settings.</p>
      </div>

      {error && <p role="alert" className="text-sm text-pretty text-destructive">{error}</p>}

      <div className="border-t pt-4">
        <Confirm
          label="Delete this page"
          question="Delete it and its versions from the archive? Saved files stay in Files."
          yes="Delete"
          pending={pending}
          onYes={() => run(async () => { await remove(page.id); router.push("/more/archive") })}
        />
      </div>
    </section>
  )
}
