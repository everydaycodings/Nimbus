"use client"

import {
  CaretRightIcon,
  CheckCircleIcon,
  CheckIcon,
  CircleNotchIcon,
  DownloadSimpleIcon,
  ListBulletsIcon,
  LockSimpleIcon,
  MagnifyingGlassIcon,
  SquaresFourIcon,
  UploadSimpleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useRef, useState, useTransition } from "react"
import { Upload } from "tus-js-client"

import { finishLinkUpload, linkUploadToken, unlockLink } from "@/app/s/actions"
import { Segmented } from "@/components/file-browser"
import { Previewer, View, downloadHref } from "@/components/previewer"
import { Thumb } from "@/components/thumb"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { fileType, formatBytes } from "@/lib/file-types"
import type { Item } from "@/lib/files"
import { cn } from "@/lib/utils"

export function PasswordGate({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const router = useRouter()
  return (
    <form
      className="mx-auto flex w-full max-w-sm flex-col gap-4 rounded-xl border bg-card p-6"
      action={(form) =>
        start(async () => {
          const res = await unlockLink(token, String(form.get("password")))
          if (res.error) setError(res.error)
          else router.refresh()
        })
      }
    >
      <span className="grid size-10 place-items-center rounded-full bg-muted">
        <LockSimpleIcon className="size-5 text-muted-foreground" />
      </span>
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">This link has a password</h1>
        <p className="text-sm text-muted-foreground">
          Ask the person who sent it if you don&apos;t have it.
        </p>
      </div>
      <Input
        name="password"
        type="password"
        aria-label="Password"
        autoComplete="current-password"
        autoFocus
        required
        aria-invalid={Boolean(error) || undefined}
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending && (
          <CircleNotchIcon className="animate-spin motion-reduce:animate-none" />
        )}
        Open
      </Button>
    </form>
  )
}

export function PublicFile({
  token,
  item,
  download,
}: {
  token: string
  item: Item
  download: boolean
}) {
  const href = downloadHref(item, undefined, { token, download })
  const t = fileType("file", item.mime, item.name)
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex items-center gap-3">
        <t.icon className={cn("size-5 shrink-0", t.color)} />
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">
          {item.name}
        </h1>
        {href && (
          <Button render={<a href={href} />} nativeButton={false}>
            <DownloadSimpleIcon />
            Download · {formatBytes(item.size)}
          </Button>
        )}
      </div>
      <div className="relative flex min-h-[70svh] flex-1">
        <View item={item} href={href} link={token} />
      </div>
    </div>
  )
}

type Crumb = { id: string; name: string }

export function PublicFolder({
  token,
  items,
  path,
  view,
  download,
}: {
  token: string
  items: Item[]
  // From the link's folder down to the one shown.
  path: Crumb[]
  view: boolean
  download: boolean
}) {
  const [layout, setLayout] = useState<"grid" | "list">("grid")
  const [q, setQ] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState<string | null>(null)
  const zip = useRef<HTMLFormElement>(null)
  const [zipIds, setZipIds] = useState<string[]>([])
  const needle = q.trim().toLowerCase()
  const shown = items
    .filter((i) => !needle || i.name.toLowerCase().includes(needle))
    .sort((a, b) =>
      a.kind !== b.kind
        ? a.kind === "folder"
          ? -1
          : 1
        : a.name.localeCompare(b.name, undefined, { numeric: true })
    )
  const files = shown.filter((i) => i.kind === "file")
  const at = files.findIndex((f) => f.id === preview)
  const folderHref = (id: string) =>
    id === path[0].id ? `/s/${token}` : `/s/${token}?f=${id}`

  function zipOf(ids: string[]) {
    setZipIds(ids)
    // Submit after the hidden inputs render.
    requestAnimationFrame(() => zip.current?.submit())
  }

  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  const box = (i: Item) =>
    download && (
      <button
        type="button"
        role="checkbox"
        aria-checked={selected.has(i.id)}
        aria-label={`Select ${i.name}`}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          toggle(i.id)
        }}
        className={cn(
          "grid size-4 shrink-0 place-items-center rounded-[4px] border border-input bg-background outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-checked:border-primary aria-checked:bg-primary",
          !selected.size &&
            "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
        )}
      >
        <CheckIcon
          weight="bold"
          className={cn(
            "size-3 text-primary-foreground",
            !selected.has(i.id) && "invisible"
          )}
        />
      </button>
    )

  // Folders open in place; files open in the previewer.
  const open = (i: Item) => (i.kind === "file" ? setPreview(i.id) : undefined)

  const tileName = (i: Item) => {
    const t = fileType(i.kind, i.mime, i.name)
    return (
      <>
        <t.icon
          weight={i.kind === "folder" ? "fill" : "regular"}
          className={cn("size-5 shrink-0", t.color)}
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {i.name}
        </span>
      </>
    )
  }

  const TILE =
    "group relative flex rounded-xl border text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"

  const tile = (i: Item, children: React.ReactNode) =>
    i.kind === "folder" ? (
      <Link
        key={i.id}
        href={folderHref(i.id)}
        className={cn(TILE, "items-center gap-3 px-3 py-2.5")}
      >
        {children}
      </Link>
    ) : (
      <button
        key={i.id}
        type="button"
        onClick={() => open(i)}
        className={cn(TILE, "flex-col")}
      >
        {children}
      </button>
    )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <nav
          aria-label="Breadcrumb"
          className="flex min-w-0 flex-1 items-center gap-1 text-2xl font-semibold tracking-tight"
        >
          {path.map((c, n) =>
            n === path.length - 1 ? (
              <h1 key={c.id} className="truncate">
                {c.name}
              </h1>
            ) : (
              <span
                key={c.id}
                className="flex min-w-0 shrink items-center gap-1"
              >
                <Link
                  href={folderHref(c.id)}
                  className="-mx-1 truncate rounded-md px-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {c.name}
                </Link>
                <CaretRightIcon className="size-4 shrink-0 text-muted-foreground" />
              </span>
            )
          )}
        </nav>
        {view && items.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                aria-label="Filter by name"
                placeholder="Filter by name"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="w-48 pl-8"
              />
            </div>
            <Segmented
              label="Layout"
              value={layout}
              onChange={setLayout}
              options={[
                { value: "list", label: "List", icon: ListBulletsIcon },
                { value: "grid", label: "Grid", icon: SquaresFourIcon },
              ]}
            />
            {download && (
              <Button
                variant="outline"
                onClick={() =>
                  zipOf(selected.size ? [...selected] : items.map((i) => i.id))
                }
              >
                <DownloadSimpleIcon />
                {selected.size ? `Download ${selected.size}` : "Download all"}
              </Button>
            )}
          </div>
        )}
      </div>

      {view && shown.length === 0 && (
        <p className="rounded-xl border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">
          {items.length
            ? "Nothing matches that name."
            : "This folder is empty."}
        </p>
      )}

      {view && shown.length > 0 && layout === "grid" && (
        <div className="flex flex-col gap-6">
          {[shown.filter((i) => i.kind === "folder"), files].map(
            (group, n) =>
              group.length > 0 && (
                <section
                  key={n}
                  aria-label={n ? "Files" : "Folders"}
                  className="flex flex-col gap-2"
                >
                  <h2 className="text-sm font-medium text-muted-foreground">
                    {n ? "Files" : "Folders"}
                  </h2>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(12rem,1fr))]">
                    {group.map((i) =>
                      tile(
                        i,
                        i.kind === "folder" ? (
                          <>
                            {tileName(i)}
                            {box(i)}
                          </>
                        ) : (
                          <>
                            <span className="flex h-11 w-full items-center gap-2 px-3">
                              {tileName(i)}
                              {box(i)}
                            </span>
                            <Thumb
                              item={i}
                              make={false}
                              link={token}
                              className="mx-1.5 mb-1.5 grid aspect-[4/3] w-[calc(100%-0.75rem)] place-items-center rounded-lg bg-muted/40"
                            >
                              <FileIcon item={i} />
                            </Thumb>
                            <span className="px-3 pb-2 text-xs text-muted-foreground tabular-nums">
                              {formatBytes(i.size)}
                            </span>
                          </>
                        )
                      )
                    )}
                  </div>
                </section>
              )
          )}
        </div>
      )}

      {view && shown.length > 0 && layout === "list" && (
        <div className="divide-y overflow-hidden rounded-xl border bg-card">
          {shown.map((i) => {
            const row = (
              <>
                <span className="flex min-w-0 flex-1 items-center gap-3">
                  {tileName(i)}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums max-sm:hidden">
                  {i.kind === "file" ? formatBytes(i.size) : ""}
                </span>
                {box(i)}
              </>
            )
            const cls =
              "group flex h-12 w-full items-center gap-3 px-3 text-left outline-none hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
            return i.kind === "folder" ? (
              <Link key={i.id} href={folderHref(i.id)} className={cls}>
                {row}
              </Link>
            ) : (
              <button
                key={i.id}
                type="button"
                onClick={() => open(i)}
                className={cls}
              >
                {row}
              </button>
            )
          })}
        </div>
      )}

      <form
        ref={zip}
        method="post"
        action={`/s/${token}/zip`}
        className="hidden"
      >
        {zipIds.map((id) => (
          <input key={id} type="hidden" name="ids" value={id} />
        ))}
      </form>

      <Previewer
        shown={at >= 0 ? { item: files[at] } : null}
        open={at >= 0}
        onClose={() => setPreview(null)}
        onPrev={at > 0 ? () => setPreview(files[at - 1].id) : undefined}
        onNext={
          at >= 0 && at < files.length - 1
            ? () => setPreview(files[at + 1].id)
            : undefined
        }
        position={
          files.length > 1 && at >= 0
            ? `${at + 1} of ${files.length}`
            : undefined
        }
        link={{ token, download }}
      />
    </div>
  )
}

function FileIcon({ item }: { item: Item }) {
  const t = fileType(item.kind, item.mime, item.name)
  return <t.icon weight="light" className={cn("size-12 opacity-80", t.color)} />
}

type Drop = {
  key: string
  name: string
  size: number
  sent: number
  status: "uploading" | "done" | "error"
  error?: string
}

// File drop: anyone with the link can send files here, but can't see what's
// already in the folder unless the link also shows it.
export function DropZone({
  token,
  folderId,
  tusUrl,
}: {
  token: string
  folderId: string
  tusUrl: string
}) {
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem("nimbus-drop-name") ?? ""
    } catch {
      return ""
    }
  })
  const [drops, setDrops] = useState<Drop[]>([])
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const router = useRouter()

  const patch = (key: string, p: Partial<Drop>) =>
    setDrops((d) => d.map((x) => (x.key === key ? { ...x, ...p } : x)))

  async function send(file: File) {
    const key = `${file.name}:${file.size}:${Math.random()}`
    setDrops((d) => [
      ...d,
      { key, name: file.name, size: file.size, sent: 0, status: "uploading" },
    ])
    const res = await linkUploadToken(
      token,
      folderId,
      file.name,
      file.size,
      name
    )
    if (!res.token)
      return patch(key, {
        status: "error",
        error: res.error ?? "Couldn't upload this.",
      })
    await new Promise<void>((done) => {
      const up = new Upload(file, {
        endpoint: tusUrl,
        retryDelays: [0, 1000, 3000, 5000],
        metadata: {
          token: res.token!,
          path: file.name,
          filetype: file.type,
          onConflict: "rename",
        },
        onProgress: (sent) => patch(key, { sent }),
        onError: () => {
          patch(key, {
            status: "error",
            error: "The upload stopped. Try again.",
          })
          done()
        },
        onSuccess: async () => {
          const fin = await finishLinkUpload(token, up.url!).catch(() => null)
          patch(
            key,
            fin?.ok
              ? { status: "done", sent: file.size }
              : { status: "error", error: fin?.error ?? "Couldn't save it." }
          )
          done()
        },
      })
      up.start()
    })
  }

  async function sendAll(files: FileList | File[]) {
    try {
      localStorage.setItem("nimbus-drop-name", name)
    } catch {}
    // Three at a time, like the app.
    const list = [...files]
    const next = async () => {
      for (let f = list.shift(); f; f = list.shift()) await send(f)
    }
    await Promise.all([next(), next(), next()])
    router.refresh()
  }

  return (
    <section
      aria-labelledby="drop-heading"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        if (e.dataTransfer.files.length) sendAll(e.dataTransfer.files)
      }}
      className={cn(
        "flex flex-col gap-4 rounded-xl border border-dashed p-6 transition-colors",
        over && "border-brand bg-brand/10"
      )}
    >
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="grid size-10 place-items-center rounded-full bg-muted">
          <UploadSimpleIcon className="size-5 text-muted-foreground" />
        </span>
        <h2 id="drop-heading" className="font-semibold">
          Send files here
        </h2>
        <p className="text-sm text-muted-foreground">
          Drop files on this box or pick them. They go straight to the
          folder&apos;s owner.
        </p>
      </div>
      <div className="mx-auto flex w-full max-w-md flex-col gap-2 sm:flex-row">
        <Input
          aria-label="Your name (optional)"
          placeholder="Your name (optional)"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
        <Button onClick={() => input.current?.click()}>Choose files</Button>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          onChange={(e) => e.target.files && sendAll(e.target.files)}
        />
      </div>
      {drops.length > 0 && (
        <ul className="mx-auto flex w-full max-w-md flex-col divide-y rounded-lg border bg-card text-sm">
          {drops.map((d) => (
            <li key={d.key} className="flex flex-col gap-1.5 px-3 py-2">
              <span className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{d.name}</span>
                {d.status === "done" ? (
                  <CheckCircleIcon
                    weight="fill"
                    className="size-4 text-brand"
                  />
                ) : d.status === "error" ? (
                  <WarningCircleIcon className="size-4 text-destructive" />
                ) : (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {Math.round((d.sent / Math.max(d.size, 1)) * 100)}%
                  </span>
                )}
              </span>
              {d.status === "uploading" && (
                <span className="h-1 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full bg-brand transition-[width]"
                    style={{
                      width: `${(d.sent / Math.max(d.size, 1)) * 100}%`,
                    }}
                  />
                </span>
              )}
              {d.error && (
                <span className="text-xs text-destructive">{d.error}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
