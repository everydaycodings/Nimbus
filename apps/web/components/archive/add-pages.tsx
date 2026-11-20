"use client"

import { BookmarkSimpleIcon, FolderSimpleIcon, PlusIcon, UploadSimpleIcon } from "@phosphor-icons/react"
import { useRef, useState, useTransition } from "react"

import { addUrls, importBookmarks } from "@/app/(app)/more/archive/actions"
import { CopyButton } from "@/components/copy-button"
import { MoveDialog, type Place } from "@/components/move-dialog"
import { CODE, TOUCH } from "@/components/registry-ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

type Way = "paste" | "bookmarks" | "bookmarklet"
const WAYS: [Way, string, string][] = [
  ["paste", "Paste addresses", "Paste"],
  ["bookmarks", "Import bookmarks", "Bookmarks"],
  ["bookmarklet", "Bookmarklet", "Bookmarklet"],
]

// The ways in: many addresses at once, a bookmarks.html, the bookmarklet. (The API is on Account → Connect's app passwords.)
export function AddPages({ ready, appUrl, onAdded, folder: start }: { ready: boolean; appUrl: string; onAdded: () => void; folder: { id: string; path: string } | null }) {
  const [way, setWay] = useState<Way>("paste")
  const [text, setText] = useState("")
  const [tags, setTags] = useState("")
  const [dest, setDest] = useState<Place | null>(null)
  const [picking, setPicking] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string }>()
  const [pending, run] = useTransition()
  const file = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState("")

  const summary = (r: { added?: number; existing?: number; bad?: string[] }) => {
    const parts = [`${r.added ?? 0} saved`]
    if (r.existing) parts.push(`${r.existing} already in your library`)
    if (r.bad?.length) parts.push(`${r.bad.length} skipped (not web addresses)`)
    return `${parts.join(", ")}. Capturing now.`
  }

  const submitPaste = (e: React.FormEvent) => {
    e.preventDefault()
    setNote(undefined)
    run(async () => {
      const r = await addUrls(text, tags, dest?.id ?? null).catch((): { error: string; added?: undefined; existing?: undefined; bad?: undefined } => ({ error: "Couldn't save. Check your connection and try again." }))
      if ("error" in r && r.error) return setNote({ ok: false, text: r.error })
      setNote({ ok: true, text: summary(r) })
      setText("")
      onAdded()
    })
  }

  const submitFile = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setNote(undefined)
    const form = new FormData(e.currentTarget)
    if (dest?.id) form.set("folder", dest.id)
    run(async () => {
      const r = await importBookmarks(form).catch((): { error: string; added?: undefined; existing?: undefined } => ({ error: "Couldn't import. Check your connection and try again." }))
      if ("error" in r && r.error) return setNote({ ok: false, text: r.error })
      setNote({ ok: true, text: summary(r) })
      setFileName("")
      if (file.current) file.current.value = ""
      onAdded()
    })
  }

  const bookmarklet = `javascript:location='${appUrl}/more/archive/add?url='+encodeURIComponent(location.href)`
  const folderButton = (
    <div className="grid gap-1.5">
      <span className="text-sm font-medium">Save in</span>
      <Button type="button" variant="outline" className={cn(TOUCH, "justify-start")} onClick={() => setPicking(true)}>
        <FolderSimpleIcon />
        <span className="truncate">{dest?.name ?? (start ? start.path : "Web archive (default)")}</span>
      </Button>
    </div>
  )

  return (
    <section aria-labelledby="add-pages" className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="add-pages" className="mr-auto text-base font-semibold">Add pages</h2>
        <div role="tablist" aria-label="Ways to add pages" className="grid w-full grid-cols-3 rounded-lg bg-muted p-[3px] sm:flex sm:w-fit">
          {WAYS.map(([w, label, short]) => (
            <button
              key={w}
              type="button"
              role="tab"
              aria-selected={way === w}
              onClick={() => { setWay(w); setNote(undefined) }}
              className="flex h-7 items-center justify-center rounded-md border border-transparent px-3 text-sm whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:h-11 aria-selected:border-input aria-selected:bg-input/30 aria-selected:text-foreground"
            >
              <span className="sm:hidden">{short}</span>
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {way === "paste" && (
        <form onSubmit={submitPaste} className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="archive-urls">Addresses, one per line</Label>
            <textarea
              id="archive-urls"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              disabled={!ready}
              placeholder={"https://example.com/an-article\nhttps://example.org/another"}
              className="min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div className="grid gap-1.5">
              <Label htmlFor="archive-tags">Tags (optional)</Label>
              <Input id="archive-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="read later, recipes" disabled={!ready} />
            </div>
            {folderButton}
            <Button type="submit" className={TOUCH} disabled={!ready || pending || !text.trim()}>
              <PlusIcon />
              {pending ? "Saving…" : "Save and capture"}
            </Button>
          </div>
        </form>
      )}

      {way === "bookmarks" && (
        <form onSubmit={submitFile} className="grid gap-3">
          <p className="max-w-prose text-sm text-pretty text-muted-foreground">
            Export your bookmarks as HTML from Chrome, Firefox, Safari or Edge, then choose the file. Each bookmark is saved, with its folders and tags kept as tags.
          </p>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">Bookmarks file</span>
              <input ref={file} type="file" name="file" accept=".html,.htm,text/html" className="sr-only" id="archive-file" disabled={!ready} onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")} />
              <Button type="button" variant="outline" className={cn(TOUCH, "justify-start")} disabled={!ready} onClick={() => file.current?.click()}>
                <UploadSimpleIcon />
                <span className="truncate">{fileName || "Choose bookmarks.html"}</span>
              </Button>
            </div>
            {folderButton}
            <Button type="submit" className={TOUCH} disabled={!ready || pending || !fileName}>
              <BookmarkSimpleIcon />
              {pending ? "Importing…" : "Import"}
            </Button>
          </div>
          <div className="grid gap-1.5 sm:max-w-sm">
            <Label htmlFor="archive-import-tags">Extra tags (optional)</Label>
            <Input id="archive-import-tags" name="tags" placeholder="imported" disabled={!ready} />
          </div>
        </form>
      )}

      {way === "bookmarklet" && (
        <div className="grid gap-3">
          <p className="max-w-prose text-sm text-pretty text-muted-foreground">
            Drag this to your bookmarks bar. On any page, click it to save that page here. It opens a short confirmation in a new view of this app, so you need to be signed in.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {/* A javascript: link on purpose, made to be dragged, not clicked here. React blocks javascript: in href, so it is set on the element. */}
            <a
              ref={(el) => el?.setAttribute("href", bookmarklet)}
              onClick={(e) => e.preventDefault()}
              draggable
              className="inline-flex h-9 cursor-grab items-center gap-2 rounded-md border border-input bg-input/30 px-3 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:h-11"
            >
              <BookmarkSimpleIcon aria-hidden />
              Save to Nimbus
            </a>
            <CopyButton value={bookmarklet} label="Copy the bookmarklet" text="Copy link" />
          </div>
          <code className={CODE}>{bookmarklet}</code>
          <p className="max-w-prose text-sm text-pretty text-muted-foreground">
            Scripts can save pages too: <code className="font-mono text-xs">POST {appUrl}/api/v1/archive</code> with HTTP Basic (your email and an app password from Account) and JSON like <code className="font-mono text-xs">{`{"url": "https://…", "tags": ["x"]}`}</code>.
          </p>
        </div>
      )}

      {note && (
        <p role={note.ok ? "status" : "alert"} className={cn("text-sm text-pretty", note.ok ? "text-muted-foreground" : "text-destructive")}>
          {note.text}
        </p>
      )}

      <MoveDialog
        open={picking}
        title="Save pages in which folder?"
        moving={[]}
        start={[{ id: null, name: "My files" }]}
        action="Save here"
        onClose={() => setPicking(false)}
        onMove={(to) => {
          setPicking(false)
          setDest(to.id ? to : null)
        }}
      />
    </section>
  )
}
