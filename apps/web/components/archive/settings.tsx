"use client"

import { FolderSimpleIcon, KeyIcon, TrashIcon } from "@phosphor-icons/react"
import { useState, useTransition } from "react"

import { chooseFolder, removeCookie, saveCookie } from "@/app/(app)/more/archive/actions"
import { MoveDialog } from "@/components/move-dialog"
import { Empty, LIST, TOUCH } from "@/components/registry-ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { CookieView } from "@/lib/archive/run"

const DAY = new Intl.DateTimeFormat("en", { dateStyle: "medium" })

export function Settings({ folder, cookies }: { folder: { id: string; path: string } | null; cookies: CookieView[] }) {
  const [picking, setPicking] = useState(false)
  const [domain, setDomain] = useState("")
  const [header, setHeader] = useState("")
  const [error, setError] = useState<string>()
  const [pending, run] = useTransition()

  const save = (e: React.FormEvent) => {
    e.preventDefault()
    setError(undefined)
    run(async () => {
      const r = await saveCookie(domain, header).catch(() => ({ error: "Couldn't save. Check your connection and try again." }))
      if (r.error) return setError(r.error)
      setDomain("")
      setHeader("")
    })
  }

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="archive-folder" className="flex flex-col gap-3">
        <div className="grid gap-0.5">
          <h2 id="archive-folder" className="text-base font-semibold">Default folder</h2>
          <p className="max-w-prose text-sm text-pretty text-muted-foreground">
            Captures are saved in a folder for each site inside it, named like <span className="font-mono text-xs">Page title (2026-11-20 1405).pdf</span>. Without a choice here they go in a Web archive folder.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" className={TOUCH} onClick={() => setPicking(true)}>
            <FolderSimpleIcon />
            <span className="max-w-[16rem] truncate">{folder ? folder.path : "Web archive (default)"}</span>
          </Button>
          {folder && (
            <Button variant="ghost" className={TOUCH} disabled={pending} onClick={() => run(async () => void (await chooseFolder(null)))}>
              Use the default
            </Button>
          )}
        </div>
      </section>

      <section aria-labelledby="archive-cookies" className="flex flex-col gap-3">
        <div className="grid gap-0.5">
          <h2 id="archive-cookies" className="text-base font-semibold">Cookies for signed-in sites</h2>
          <p className="max-w-prose text-sm text-pretty text-muted-foreground">
            To save a page that needs you signed in, paste the site&apos;s Cookie header (browser developer tools, Network, any request to the site). It is stored encrypted, sent only to that site and its subdomains, and can&apos;t be shown again.
          </p>
        </div>
        <form onSubmit={save} className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-[14rem_1fr_auto] sm:items-end">
          <div className="grid gap-1.5">
            <Label htmlFor="cookie-domain">Site</Label>
            <Input id="cookie-domain" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" autoComplete="off" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cookie-header">Cookie header</Label>
            <Input id="cookie-header" type="password" value={header} onChange={(e) => setHeader(e.target.value)} placeholder="session=…; theme=…" autoComplete="off" spellCheck={false} />
          </div>
          <Button type="submit" className={TOUCH} disabled={pending || !domain.trim() || !header.trim()}>
            {pending ? "Saving…" : "Save cookies"}
          </Button>
          {error && <p role="alert" className="text-sm text-pretty text-destructive sm:col-span-3">{error}</p>}
        </form>
        {cookies.length === 0 ? (
          <Empty icon={KeyIcon} title="No cookies saved">
            <p>Pages that are public need none.</p>
          </Empty>
        ) : (
          <ul className={LIST}>
            {cookies.map((c) => (
              <li key={c.id} className="flex items-center gap-3 p-3">
                <KeyIcon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
                <div className="mr-auto min-w-0">
                  <p className="truncate text-sm font-medium">{c.domain}</p>
                  <p className="text-sm text-muted-foreground">Saved {DAY.format(new Date(c.createdAt))}</p>
                </div>
                <Button variant="ghost" size="icon" className="pointer-coarse:size-11" aria-label={`Delete the cookies for ${c.domain}`} onClick={() => run(async () => void (await removeCookie(c.id)))}>
                  <TrashIcon />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <MoveDialog
        open={picking}
        title="Archive into which folder?"
        moving={[]}
        start={[{ id: null, name: "My files" }]}
        action="Use this folder"
        onClose={() => setPicking(false)}
        onMove={(to) => {
          setPicking(false)
          if (to.id) run(async () => void (await chooseFolder(to.id)))
        }}
      />
    </div>
  )
}
