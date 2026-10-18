"use client"

import { Dialog } from "@base-ui/react/dialog"
import {
  ArrowsInIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CheckIcon,
  CircleNotchIcon,
  CopyIcon,
  DownloadSimpleIcon,
  FolderIcon,
  InfoIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  TextAlignLeftIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react"
import { useEffect, useId, useRef, useState } from "react"

import { officeFrame, previewUrl } from "@/app/(app)/upload-actions"
import { linkPreviewUrl } from "@/app/s/actions"
import { Button } from "@/components/ui/button"
import { Thumb } from "@/components/thumb"
import { VideoPlayer } from "@/components/video-player"
import { parseCsv } from "@/lib/csv"
import { fileType, formatBytes } from "@/lib/file-types"
import { OFFICE_EXT, previewKind } from "@/lib/file-rules"
import type { Item } from "@/lib/files"
import { SHIKI_THEME, langOf, readRange } from "@/lib/thumbs"
import { cn } from "@/lib/utils"

// A file decrypted in the browser (vault files): its bytes and an object URL
// for them. Null while it's still decrypting.
export type Decrypted = { blob: Blob; url: string } | null

// What the previewer shows: a file, or one of its older versions.
export type Shown = {
  item: Item
  version?: { id: string; number: number; size: number; mime: string | null }
}

const TEXT_MAX = 2 * 1024 ** 2
// Past this, code shows plain: highlighting megabytes stalls the page.
const HIGHLIGHT_MAX = 256 * 1024
const OFFICE_MAX = 50 * 1024 ** 2
const ROWS = 1000
const OPEN_FAILED = "Couldn't open this file."
// fetch() rejects with a TypeError when the bucket's CORS rule blocks it.
const CORS_FAILED =
  "Couldn't download the file. If this keeps happening, an admin should check the storage bucket's CORS rule."

// Full-screen overlay for one file at a time. Arrows step through the folder.
export function Previewer({
  shown,
  open,
  onClose,
  onPrev,
  onNext,
  position,
  onDetails,
  menu,
  onUseFrame,
  link,
  src,
}: {
  shown: Shown | null
  open: boolean
  onClose: () => void
  // Missing at either end of the folder.
  onPrev?: () => void
  onNext?: () => void
  // "3 of 12"
  position?: string
  onDetails?: () => void
  // The file's ⋯ menu from the browser.
  menu?: React.ReactNode
  // Makes a paused video frame the file's thumbnail; only for its editors.
  onUseFrame?: (item: Item, video: HTMLVideoElement) => Promise<void>
  // On a public link's page: its token, and whether it allows downloads.
  link?: { token: string; download: boolean }
  // Decrypted bytes to show instead of fetching the file from the server.
  src?: Decrypted
}) {
  const item = shown?.item
  const v = shown?.version
  const t = item && fileType("file", item.mime, item.name)
  const href =
    src !== undefined ? (src?.url ?? null) : item && downloadHref(item, v, link)

  function onKeyDown(e: React.KeyboardEvent) {
    if (
      e.target instanceof HTMLElement &&
      e.target.closest("video, audio, input, textarea, [role=menu]")
    )
      return
    if (e.key === "ArrowLeft" && onPrev) onPrev()
    else if (e.key === "ArrowRight" && onNext) onNext()
    else return
    e.preventDefault()
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/95 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup
          onKeyDown={onKeyDown}
          className="fixed inset-0 z-50 flex flex-col transition-opacity duration-150 outline-none data-ending-style:opacity-0 data-starting-style:opacity-0"
        >
          {item && t && (
            <>
              <header className="flex h-14 shrink-0 items-center gap-2 px-2 sm:px-3">
                <Dialog.Close
                  render={
                    <Button variant="ghost" size="icon" aria-label="Close" />
                  }
                >
                  <XIcon className="size-5" />
                </Dialog.Close>
                <t.icon className={cn("size-5 shrink-0", t.color)} />
                <Dialog.Title className="min-w-0 truncate text-sm font-medium">
                  {item.name}
                </Dialog.Title>
                {v && (
                  <span className="shrink-0 rounded-md border px-1.5 text-xs text-muted-foreground">
                    v{v.number}
                  </span>
                )}
                <span className="ml-auto hidden shrink-0 text-xs text-muted-foreground tabular-nums sm:block">
                  {position}
                </span>
                {href && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Download"
                    title="Download"
                    render={<a href={href} download={blobName(href, item)} />}
                    nativeButton={false}
                    className="max-sm:ml-auto"
                  >
                    <DownloadSimpleIcon className="size-5" />
                  </Button>
                )}
                {onDetails && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Details"
                    title="Details"
                    onClick={onDetails}
                  >
                    <InfoIcon className="size-5" />
                  </Button>
                )}
                {!v && menu}
              </header>
              <div
                className="relative flex min-h-0 flex-1 px-2 pb-2 sm:px-16 sm:pb-6"
                // No right-click "Save as" when a link turned downloads off.
                onContextMenu={href ? undefined : (e) => e.preventDefault()}
              >
                <View
                  key={`${item.id}:${v?.id ?? item.version}`}
                  item={item}
                  version={v}
                  href={href ?? null}
                  link={link?.token}
                  src={src}
                  onUseFrame={
                    onUseFrame && !v
                      ? (video) => onUseFrame(item, video)
                      : undefined
                  }
                />
                {onPrev && (
                  <Step label="Previous file" onClick={onPrev} side="left" />
                )}
                {onNext && (
                  <Step label="Next file" onClick={onNext} side="right" />
                )}
              </div>
            </>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Step({
  label,
  onClick,
  side,
}: {
  label: string
  onClick: () => void
  side: "left" | "right"
}) {
  const Icon = side === "left" ? CaretLeftIcon : CaretRightIcon
  return (
    <Button
      variant="outline"
      size="icon"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "absolute top-1/2 z-10 -translate-y-1/2 rounded-full bg-background/70 backdrop-blur-sm",
        side === "left" ? "left-2 sm:left-4" : "right-2 sm:right-4"
      )}
    >
      <Icon className="size-4" />
    </Button>
  )
}

// Where the file downloads from, or null when a link turned downloads off.
export function downloadHref(
  item: Item,
  v?: Shown["version"],
  link?: { token: string; download: boolean }
) {
  if (link) return link.download ? `/s/${link.token}/download/${item.id}` : null
  return `/api/files/${item.id}/download${v ? `?v=${v.id}` : ""}`
}

// Object URLs open in the tab unless the link says to save them.
const blobName = (href: string, item: Item) =>
  href.startsWith("blob:") ? item.name : undefined

// Fetches a short-lived URL for the file, then hands it to its viewer.
// Exported for the public link page, which shows one file inline.
export function View({
  item,
  version,
  href,
  link,
  src,
  onUseFrame,
}: {
  item: Item
  version?: Shown["version"]
  href: string | null
  // A public link's token: URLs come from the link, and Collabora is skipped.
  link?: string
  // Already-decrypted bytes: no server URL, and Collabora is skipped.
  src?: Decrypted
  onUseFrame?: (video: HTMLVideoElement) => Promise<void>
}) {
  const mime = version ? version.mime : item.mime
  const size = version ? version.size : item.size
  const kind = previewKind(mime, item.name)
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  // Collabora's viewer: undefined while asking, null when it's off.
  const [frame, setFrame] = useState<
    Awaited<ReturnType<typeof officeFrame>> | undefined
  >(!link && src === undefined && OFFICE_EXT.test(item.name) ? undefined : null)

  useEffect(() => {
    if (frame !== undefined) return
    let live = true
    officeFrame(item.id, version?.id).then(
      (f) => live && setFrame(f),
      () => live && setFrame(null)
    )
    return () => {
      live = false
    }
  }, [item.id, version?.id, frame])

  useEffect(() => {
    if (!kind || frame !== null || src !== undefined) return
    let live = true
    ;(link
      ? linkPreviewUrl(link, item.id)
      : previewUrl(item.id, version?.id, true)
    ).then(
      (u) => live && (u ? setUrl(u) : setFailed(OPEN_FAILED)),
      () => live && setFailed(OPEN_FAILED)
    )
    return () => {
      live = false
    }
  }, [item.id, version?.id, kind, frame, link, src])

  if (frame === undefined || src === null) return <Loading />
  if (frame) return <OfficeView {...frame} title={item.name} />
  if (!kind) return <NoPreview item={item} href={href} />
  if (failed) return <NoPreview item={item} href={href} error={failed} />
  const shownUrl = src?.url ?? url
  if (!shownUrl) return <Loading />

  const props = {
    url: shownUrl,
    data: src?.blob ?? shownUrl,
    item,
    size,
    href,
  }
  switch (kind) {
    case "image":
      return <ImageView {...props} />
    case "video":
      return (
        <VideoPlayer
          src={shownUrl}
          title={item.name}
          onUseFrame={onUseFrame}
          onError={() => setFailed("This video can't play in this browser.")}
        />
      )
    case "audio":
      return <AudioView {...props} />
    case "pdf":
      return (
        <iframe
          // Hides the browser's PDF toolbar, and its download button.
          src={href ? shownUrl : `${shownUrl}#toolbar=0`}
          title={item.name}
          className="size-full rounded-lg border bg-white"
        />
      )
    case "markdown":
    case "text":
      return <TextView {...props} markdown={kind === "markdown"} />
    case "csv":
      return <CsvView {...props} />
    case "sheet":
      return <SheetView {...props} />
    case "docx":
      return <DocxView {...props} />
    case "zip":
      return <ZipView {...props} />
  }
}

type ViewProps = {
  url: string
  // What readers read from: the URL, or the decrypted bytes.
  data: string | Blob
  item: Item
  size: number
  href: string | null
}

// WOPI hosts hand the token over in a form POST, not the URL.
function OfficeView({
  action,
  token,
  title,
}: {
  action: string
  token: string
  title: string
}) {
  const form = useRef<HTMLFormElement>(null)
  const target = useId()
  useEffect(() => form.current?.submit(), [])
  return (
    <>
      <form
        ref={form}
        action={action}
        method="post"
        target={target}
        className="hidden"
      >
        <input type="hidden" name="access_token" value={token} />
        <input type="hidden" name="access_token_ttl" value="0" />
      </form>
      <iframe
        name={target}
        title={title}
        allow="fullscreen; clipboard-read; clipboard-write"
        className="size-full rounded-lg border bg-white"
      />
    </>
  )
}

function Loading() {
  return (
    <div className="m-auto flex items-center gap-2 text-sm text-muted-foreground">
      <CircleNotchIcon className="size-4 animate-spin motion-reduce:animate-none" />
      Loading preview…
    </div>
  )
}

function NoPreview({
  item,
  href,
  error,
}: {
  item: Item
  href: string | null
  error?: string
}) {
  const t = fileType("file", item.mime, item.name)
  return (
    <div className="m-auto flex max-w-sm flex-col items-center gap-3 text-center">
      {error ? (
        <WarningCircleIcon className="size-12 text-destructive" />
      ) : (
        <t.icon weight="light" className={cn("size-16", t.color)} />
      )}
      <div className="flex flex-col gap-1">
        <p className="font-medium">
          {error ?? "No preview for this kind of file"}
        </p>
        <p className="text-sm text-muted-foreground">
          {href
            ? "Download it to open it on your device."
            : "Downloads are turned off for this link."}
        </p>
      </div>
      {href && (
        <Button
          render={<a href={href} download={blobName(href, item)} />}
          nativeButton={false}
        >
          <DownloadSimpleIcon />
          Download · {formatBytes(item.size)}
        </Button>
      )}
    </div>
  )
}

// Loads something from the file once; `null` while loading.
function useLoad<T>(load: () => Promise<T>) {
  const [state, setState] = useState<{ value?: T; error?: string } | null>(null)
  const ran = useRef(false)
  useEffect(() => {
    if (ran.current) return
    ran.current = true
    load().then(
      (value) => setState({ value }),
      (e: Error) =>
        setState({
          error:
            e instanceof TypeError
              ? CORS_FAILED
              : e.message || "Couldn't load the preview.",
        })
    )
  }, [load])
  return state
}

function Failed({
  error,
  href,
  item,
}: {
  error: string
  href: string | null
  item: Item
}) {
  return <NoPreview item={item} href={href} error={error} />
}

// Fit to the screen, or zoom with the wheel, buttons or a double-click, and
// drag to pan.
function ImageView({ url, item, href }: ViewProps) {
  const img = useRef<HTMLImageElement>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [broken, setBroken] = useState(false)
  const [dragging, setDragging] = useState(false)
  const drag = useRef({ x: 0, y: 0 })
  // Zoom that shows the image at its own pixel size, measured once it loads.
  const [actual, setActual] = useState(1)

  // Keeps the point under (cx, cy), relative to the center, still.
  function zoomTo(next: number, cx = 0, cy = 0) {
    const z = Math.min(Math.max(next, 1), Math.max(8, actual * 2))
    setPan((p) =>
      z === 1
        ? { x: 0, y: 0 }
        : { x: cx - ((cx - p.x) * z) / zoom, y: cy - ((cy - p.y) * z) / zoom }
    )
    setZoom(z)
  }

  function center(e: React.MouseEvent<HTMLElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    return [e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2]
  }

  if (broken)
    return (
      <Failed item={item} href={href} error="This image can't be shown here." />
    )

  const fitted = zoom === 1
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        className={cn(
          "relative flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden",
          !fitted && "cursor-grab active:cursor-grabbing"
        )}
        onWheel={(e) => {
          const [cx, cy] = center(e)
          zoomTo(zoom * Math.exp(-e.deltaY * 0.002), cx, cy)
        }}
        onDoubleClick={(e) => {
          const [cx, cy] = center(e)
          zoomTo(fitted ? (actual > 1.1 ? actual : 2) : 1, cx, cy)
        }}
        onPointerDown={(e) => {
          if (fitted) return
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }
          setDragging(true)
        }}
        onPointerMove={(e) => {
          if (dragging)
            setPan({
              x: e.clientX - drag.current.x,
              y: e.clientY - drag.current.y,
            })
        }}
        onPointerUp={() => setDragging(false)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- presigned S3 URL */}
        <img
          ref={img}
          src={url}
          alt={item.name}
          draggable={false}
          onError={() => setBroken(true)}
          onLoad={(e) => {
            const el = e.currentTarget
            if (el.clientWidth) setActual(el.naturalWidth / el.clientWidth)
          }}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }}
          className={cn(
            "max-h-full max-w-full object-contain select-none",
            !dragging &&
              "transition-transform duration-100 ease-out motion-reduce:transition-none"
          )}
        />
      </div>
      <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full border bg-background/80 p-1 shadow-lg backdrop-blur-sm">
        <Button
          variant="ghost"
          size="icon-sm"
          className="rounded-full"
          aria-label="Zoom out"
          disabled={fitted}
          onClick={() => zoomTo(zoom / 1.5)}
        >
          <MagnifyingGlassMinusIcon />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="min-w-16 rounded-full tabular-nums"
          onClick={() => zoomTo(fitted ? actual : 1)}
          title={fitted ? "Actual size" : "Fit to screen"}
        >
          {fitted ? "Fit" : `${Math.round((zoom / actual) * 100)}%`}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="rounded-full"
          aria-label="Zoom in"
          onClick={() => zoomTo(zoom * 1.5)}
        >
          <MagnifyingGlassPlusIcon />
        </Button>
        {!fitted && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-full"
            aria-label="Fit to screen"
            onClick={() => zoomTo(1)}
          >
            <ArrowsInIcon />
          </Button>
        )}
      </div>
    </div>
  )
}

function AudioView({ url, item, href }: ViewProps) {
  const t = fileType("file", item.mime, item.name)
  return (
    <div className="m-auto flex w-full max-w-md flex-col items-center gap-6">
      <Thumb
        item={item}
        make={false}
        className="grid aspect-square w-56 place-items-center rounded-xl border bg-muted/40 shadow-lg"
      >
        <t.icon weight="light" className={cn("size-20", t.color)} />
      </Thumb>
      <audio
        src={url}
        controls
        controlsList={href ? undefined : "nodownload"}
        autoPlay
        className="w-full"
      />
    </div>
  )
}

// Code and plain text, highlighted by shiki, with line numbers. Markdown also
// renders, sanitised, with a toggle back to its source.
function TextView({
  data,
  item,
  size,
  href,
  markdown,
}: ViewProps & { markdown: boolean }) {
  const [wrap, setWrap] = useState(markdown)
  const [source, setSource] = useState(!markdown)
  const [copied, setCopied] = useState(false)
  const loaded = useLoad(async () => {
    const bytes = await readRange(data, 0, Math.min(size, TEXT_MAX))
    const text = new TextDecoder().decode(bytes)
    let html: string | null = null
    let rendered: string | null = null
    if (text.length <= HIGHLIGHT_MAX) {
      const { codeToHtml } = await import("shiki")
      html = await codeToHtml(text, {
        lang: markdown ? "md" : await langOf(item.name),
        theme: SHIKI_THEME,
      })
    }
    if (markdown) {
      const [{ marked }, { default: DOMPurify }] = await Promise.all([
        import("marked"),
        import("dompurify"),
      ])
      // Links leave in a new tab instead of replacing Nimbus.
      DOMPurify.removeHook("afterSanitizeAttributes")
      DOMPurify.addHook("afterSanitizeAttributes", (node) => {
        if (node.tagName !== "A") return
        node.setAttribute("target", "_blank")
        node.setAttribute("rel", "noopener noreferrer")
      })
      rendered = DOMPurify.sanitize(await marked.parse(text), {
        FORBID_TAGS: ["style", "form"],
      })
    }
    return { text, html, rendered }
  })

  if (!loaded) return <Loading />
  if (loaded.error || !loaded.value)
    return <Failed item={item} href={href} error={loaded.error!} />
  const { text, html, rendered } = loaded.value
  const cut = size > TEXT_MAX

  async function copy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col overflow-hidden rounded-xl border bg-background">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b px-2 text-xs text-muted-foreground">
        {markdown && (
          <div className="flex rounded-md bg-muted p-[3px]">
            {(["Preview", "Source"] as const).map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={(l === "Source") === source}
                onClick={() => setSource(l === "Source")}
                className="h-6 rounded-[5px] border border-transparent px-2 text-xs font-medium text-muted-foreground aria-pressed:border-input aria-pressed:bg-input/30 aria-pressed:text-foreground"
              >
                {l}
              </button>
            ))}
          </div>
        )}
        <span className="px-1 tabular-nums">
          {text.split("\n").length.toLocaleString()} lines
          {cut && ` · first ${formatBytes(TEXT_MAX)} of ${formatBytes(size)}`}
        </span>
        <span className="ml-auto" />
        {(source || !markdown) && (
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={wrap}
            onClick={() => setWrap(!wrap)}
            className="aria-pressed:bg-muted aria-pressed:text-foreground"
          >
            <TextAlignLeftIcon />
            Wrap
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={copy}>
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {!source && rendered !== null ? (
          <article
            className="markdown mx-auto max-w-3xl px-6 py-8"
            dangerouslySetInnerHTML={{ __html: rendered }}
          />
        ) : (
          <div
            className={cn(
              "code-view py-3 font-mono text-[13px] leading-5",
              wrap && "wrap"
            )}
          >
            {html !== null ? (
              <div dangerouslySetInnerHTML={{ __html: html }} />
            ) : (
              <pre>
                <code>
                  {text.split("\n").map((l, i) => (
                    <span key={i} className="line">
                      {l}
                      {"\n"}
                    </span>
                  ))}
                </code>
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Table({ rows, note }: { rows: string[][]; note?: string }) {
  const width = Math.max(0, ...rows.map((r) => r.length))
  const [head, ...body] = rows
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col overflow-hidden rounded-xl border bg-background">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="text-sm tabular-nums">
          {head && (
            <thead className="sticky top-0 bg-card">
              <tr>
                <th className="w-12 border-r border-b" />
                {Array.from({ length: width }, (_, i) => (
                  <th
                    key={i}
                    className="max-w-80 truncate border-r border-b px-3 py-2 text-left font-medium whitespace-nowrap"
                  >
                    {head[i]}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {body.map((r, i) => (
              <tr key={i} className="hover:bg-muted/40">
                <td className="border-r border-b px-2 text-right text-xs text-muted-foreground">
                  {i + 2}
                </td>
                {Array.from({ length: width }, (_, j) => (
                  <td
                    key={j}
                    title={r[j]}
                    className="max-w-80 truncate border-r border-b px-3 py-1.5 whitespace-nowrap"
                  >
                    {r[j]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {note && (
        <p className="shrink-0 border-t px-3 py-2 text-xs text-muted-foreground">
          {note}
        </p>
      )}
    </div>
  )
}

const rowsNote = (shown: number, more: boolean) =>
  more ? `Showing the first ${shown.toLocaleString()} rows.` : undefined

function CsvView({ data, item, size, href }: ViewProps) {
  const loaded = useLoad(async () => {
    const bytes = await readRange(data, 0, Math.min(size, 5 * TEXT_MAX))
    const sep = /\.tsv$/i.test(item.name) ? "\t" : ","
    return parseCsv(new TextDecoder().decode(bytes), sep, ROWS + 2)
  })
  if (!loaded) return <Loading />
  if (loaded.error || !loaded.value)
    return <Failed item={item} href={href} error={loaded.error!} />
  const rows = loaded.value.slice(0, ROWS + 1)
  return (
    <Table
      rows={rows}
      note={rowsNote(
        ROWS,
        loaded.value.length > ROWS + 1 || size > 5 * TEXT_MAX
      )}
    />
  )
}

function SheetView({ data, item, size, href }: ViewProps) {
  const [tab, setTab] = useState(0)
  const loaded = useLoad(async () => {
    if (size > OFFICE_MAX)
      throw new Error("This spreadsheet is too big to preview.")
    const XLSX = await import("xlsx")
    const book = XLSX.read(await readRange(data, 0, size), {
      sheetRows: ROWS + 1,
    })
    return book.SheetNames.map((name) => ({
      name,
      rows: XLSX.utils.sheet_to_json<string[]>(book.Sheets[name], {
        header: 1,
        raw: false,
        defval: "",
      }),
    }))
  })
  if (!loaded) return <Loading />
  if (loaded.error || !loaded.value)
    return <Failed item={item} href={href} error={loaded.error!} />
  const sheets = loaded.value
  const sheet = sheets[tab]
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <Table
        rows={sheet.rows}
        note={rowsNote(ROWS, sheet.rows.length > ROWS)}
      />
      {sheets.length > 1 && (
        <div className="mx-auto flex max-w-full gap-0.5 overflow-x-auto rounded-md bg-muted p-[3px]">
          {sheets.map((s, i) => (
            <button
              key={s.name}
              type="button"
              aria-pressed={i === tab}
              onClick={() => setTab(i)}
              className="h-7 shrink-0 rounded-[5px] border border-transparent px-3 text-xs font-medium text-muted-foreground aria-pressed:border-input aria-pressed:bg-input/30 aria-pressed:text-foreground"
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function DocxView({ data, item, size, href }: ViewProps) {
  const box = useRef<HTMLDivElement>(null)
  const loaded = useLoad(async () => {
    if (size > OFFICE_MAX)
      throw new Error("This document is too big to preview.")
    const [{ renderAsync }, bytes] = await Promise.all([
      import("docx-preview"),
      readRange(data, 0, size),
    ])
    await renderAsync(new Blob([bytes as BlobPart]), box.current!, undefined, {
      renderAltChunks: false,
      ignoreLastRenderedPageBreak: true,
    })
    // Links in a document can say anything; keep the ones that go somewhere real.
    for (const a of box.current!.querySelectorAll("a[href]")) {
      if (!/^(https?:|mailto:|#)/i.test(a.getAttribute("href")!))
        a.removeAttribute("href")
      else a.setAttribute("target", "_blank")
      a.setAttribute("rel", "noopener noreferrer")
    }
    return true
  })
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto rounded-xl">
      {!loaded && <Loading />}
      {loaded?.error && <Failed item={item} href={href} error={loaded.error} />}
      <div
        ref={box}
        className="[&_.docx-wrapper]:bg-transparent [&_.docx-wrapper]:p-0 [&_.docx-wrapper>section]:mb-4 [&_.docx-wrapper>section]:rounded-sm"
      />
    </div>
  )
}

function ZipView({ data, item, size, href }: ViewProps) {
  const loaded = useLoad(async () => {
    const { unzipRaw } = await import("unzipit")
    // Presigned URLs only allow GET, so the length comes from the file row.
    const { entries } = await unzipRaw({
      getLength: async () => size,
      read: async (offset, n) =>
        (await readRange(data, offset, offset + n)) as Uint8Array<ArrayBuffer>,
    })
    return entries
      .filter((e) => !e.isDirectory)
      .map((e) => ({ name: e.name, size: e.size, date: e.lastModDate }))
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true })
      )
  })
  if (!loaded) return <Loading />
  if (loaded.error || !loaded.value)
    return (
      <Failed item={item} href={href} error="Couldn't read this zip file." />
    )
  const files = loaded.value
  const total = files.reduce((n, f) => n + f.size, 0)
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col overflow-hidden rounded-xl border bg-card">
      <p className="shrink-0 border-b px-4 py-3 text-sm text-muted-foreground tabular-nums">
        {files.length.toLocaleString()} {files.length === 1 ? "file" : "files"}{" "}
        · {formatBytes(total)} unzipped
      </p>
      <ul className="min-h-0 flex-1 divide-y overflow-auto">
        {files.slice(0, 5000).map((f) => {
          const t = fileType("file", null, f.name)
          const slash = f.name.lastIndexOf("/")
          return (
            <li
              key={f.name}
              className="flex items-center gap-3 px-4 py-2 text-sm"
            >
              <t.icon className={cn("size-4 shrink-0", t.color)} />
              <span className="min-w-0 flex-1 truncate" title={f.name}>
                {slash > 0 && (
                  <span className="text-muted-foreground">
                    {f.name.slice(0, slash + 1)}
                  </span>
                )}
                {f.name.slice(slash + 1)}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {formatBytes(f.size)}
              </span>
            </li>
          )
        })}
      </ul>
      {files.length > 5000 && (
        <p className="flex shrink-0 items-center gap-2 border-t px-4 py-2 text-xs text-muted-foreground">
          <FolderIcon className="size-3.5" />
          Showing the first 5,000 files.
        </p>
      )}
    </div>
  )
}
