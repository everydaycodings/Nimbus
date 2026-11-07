"use client"

import { Dialog } from "@base-ui/react/dialog"
import {
  CaretRightIcon,
  CheckCircleIcon,
  CheckIcon,
  CircleNotchIcon,
  CloudArrowUpIcon,
  FolderIcon,
  PaperPlaneTiltIcon,
  XIcon,
} from "@phosphor-icons/react"
import { createContext, useContext, useEffect, useRef, useState } from "react"
import { Upload } from "tus-js-client"

import {
  addTransferFileToken,
  createTransfer,
  discardTransfer,
  finaliseTransfer,
  pickItems,
  transferSetup,
} from "@/app/(app)/transfers/actions"
import { finishUpload } from "@/app/(app)/upload-actions"
import { CopyButton } from "@/components/copy-button"
import { DIALOG_BACKDROP, DIALOG_POPUP } from "@/components/overlay-styles"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { fileType, formatBytes } from "@/lib/file-types"
import { cn } from "@/lib/utils"
import type { TransferOptions } from "@nimbus/shared/api"

export type Picked = {
  id: string
  name: string
  kind: "file" | "folder"
  mime?: string | null
  size?: number
}
type Entry = Picked & { size: number }

const SELECT =
  "h-9 rounded-md border border-input bg-input/30 px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
const DAYS = (max: number) => [1, 7, 30].filter((d) => d <= max)

// New transfer: files from Nimbus and/or this computer, who gets them, and the
// limits. The Nimbus items are copied when it starts; device files upload with
// a token for the draft; finalising emails everyone and shows the link.
export function TransferDialog({
  open,
  onClose,
  initial = [],
  options,
  tusUrl,
}: {
  open: boolean
  onClose: () => void
  initial?: Picked[]
  options: TransferOptions
  tusUrl: string
}) {
  const days = DAYS(options.maxDays).length ? DAYS(options.maxDays) : [1]
  const [picked, setPicked] = useState<Picked[]>(initial)
  const [device, setDevice] = useState<File[]>([])
  const [picking, setPicking] = useState(false)
  const [emails, setEmails] = useState("")
  const [link, setLink] = useState(true)
  const [title, setTitle] = useState("")
  const [note, setNote] = useState("")
  const [expiry, setExpiry] = useState(days.includes(7) ? 7 : days[0])
  const [password, setPassword] = useState("")
  const [limit, setLimit] = useState("")
  const [stage, setStage] = useState<"form" | "sending" | "done">("form")
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<{
    link: string | null
    people: number
  } | null>(null)
  // Percent per device file while uploading.
  const [progress, setProgress] = useState<number[]>([])
  // A failed send resumes the same draft, skipping files already uploaded.
  // ponytail: edits to the form after a failure aren't applied to that draft.
  const draft = useRef<{ id: string; uploaded: Set<number> } | null>(null)
  const file = useRef<HTMLInputElement>(null)

  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setPicked(initial)
      setDevice([])
      setStage("form")
      setError(null)
      setSent(null)
    }
  }

  const people = emails
    .split(/[\s,;]+/)
    .map((e) => e.trim())
    .filter(Boolean)
  const count = picked.length + device.length
  const useLink = link || !options.email || !people.length
  const busy = stage === "sending"

  function upload(f: File, id: string, n: number): Promise<string | null> {
    return addTransferFileToken(id, f.name, f.size).then((t) => {
      if (!t.token) return t.error ?? "Couldn't upload this."
      return new Promise<string | null>((done) => {
        const up = new Upload(f, {
          endpoint: tusUrl,
          retryDelays: [0, 1000, 3000, 5000],
          metadata: { token: t.token!, path: f.name, filetype: f.type },
          onProgress: (sentBytes) =>
            setProgress((p) =>
              p.map((v, i) =>
                i === n
                  ? Math.round((sentBytes / Math.max(f.size, 1)) * 100)
                  : v
              )
            ),
          onError: () => done(`“${f.name}” stopped uploading.`),
          onSuccess: async () => {
            const r = await finishUpload(up.url!).catch(() => null)
            done(
              r && !r.error ? null : (r?.error ?? `Couldn't save “${f.name}”.`)
            )
          },
        })
        up.start()
      })
    })
  }

  async function send() {
    setError(null)
    setStage("sending")
    setProgress(device.map(() => 0))
    if (!draft.current) {
      const r = await createTransfer({
        nodeIds: picked.map((p) => p.id),
        title,
        message: note,
        days: expiry,
        password,
        downloadLimit: limit ? Number(limit) : null,
        emails: people,
        link: useLink,
      })
      if (!r.id) {
        setError(r.error ?? "Couldn't start the transfer.")
        return setStage("form")
      }
      draft.current = { id: r.id, uploaded: new Set() }
    }
    const d = draft.current
    // Three at a time, like the uploader.
    const todo = device.map((f, i) => i).filter((i) => !d.uploaded.has(i))
    let failed: string | null = null
    const next = async () => {
      for (let i = todo.shift(); i !== undefined && !failed; i = todo.shift()) {
        const err = await upload(device[i], d.id, i)
        if (err) failed = err
        else d.uploaded.add(i)
      }
    }
    await Promise.all([next(), next(), next()])
    if (failed) {
      setError(failed)
      return setStage("form")
    }
    const r = await finaliseTransfer(d.id)
    if (r.error) {
      setError(r.error)
      return setStage("form")
    }
    setSent({
      link: r.linkToken ? `${location.origin}/t/${r.linkToken}` : null,
      people: people.length,
    })
    draft.current = null
    setStage("done")
  }

  const rm = (fn: () => void) => (
    <button
      type="button"
      aria-label="Remove"
      disabled={busy}
      onClick={fn}
      className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <XIcon className="size-3.5" />
    </button>
  )

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (o || busy) return
        // Closing with a half-made draft throws it away.
        if (draft.current) void discardTransfer(draft.current.id)
        draft.current = null
        onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup
          className={cn(
            DIALOG_POPUP,
            "max-h-[calc(100svh-2rem)] max-w-lg overflow-y-auto"
          )}
        >
          <Dialog.Title className="flex items-center gap-2 text-base font-semibold">
            <PaperPlaneTiltIcon className="size-5" />
            {stage === "done" ? "Transfer sent" : "New transfer"}
          </Dialog.Title>

          {stage === "done" && sent ? (
            <div className="flex flex-col gap-4">
              <p className="flex items-center gap-2 text-sm">
                <CheckCircleIcon weight="fill" className="size-5 text-brand" />
                {sent.people
                  ? `Emailed ${sent.people} ${sent.people === 1 ? "person" : "people"}.`
                  : "Your files are ready to share."}
              </p>
              {sent.link && (
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={sent.link}
                    aria-label="Link"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <CopyButton value={sent.link} />
                </div>
              )}
              <div className="flex justify-end">
                <Button onClick={onClose}>Done</Button>
              </div>
            </div>
          ) : picking ? (
            <NimbusPicker
              chosen={picked}
              onDone={(p) => {
                setPicked(p)
                setPicking(false)
              }}
            />
          ) : (
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                void send()
              }}
            >
              <section aria-label="Files" className="flex flex-col gap-2">
                {count > 0 && (
                  <ul className="max-h-40 divide-y overflow-y-auto rounded-lg border text-sm">
                    {picked.map((p) => (
                      <li
                        key={p.id}
                        className="flex items-center gap-2 px-3 py-1.5"
                      >
                        <RowIcon
                          kind={p.kind}
                          mime={p.mime ?? null}
                          name={p.name}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {p.name}
                        </span>
                        {p.kind === "file" && p.size !== undefined && (
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {formatBytes(p.size)}
                          </span>
                        )}
                        {rm(() =>
                          setPicked(picked.filter((x) => x.id !== p.id))
                        )}
                      </li>
                    ))}
                    {device.map((f, i) => (
                      <li
                        key={`${f.name}:${i}`}
                        className="flex flex-col gap-1 px-3 py-1.5"
                      >
                        <span className="flex items-center gap-2">
                          <RowIcon
                            kind="file"
                            mime={f.type || null}
                            name={f.name}
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {f.name}
                          </span>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {busy
                              ? `${progress[i] ?? 0}%`
                              : formatBytes(f.size)}
                          </span>
                          {rm(() =>
                            setDevice(device.filter((_, j) => j !== i))
                          )}
                        </span>
                        {busy && (
                          <span className="h-1 overflow-hidden rounded-full bg-muted">
                            <span
                              className="block h-full bg-brand transition-[width]"
                              style={{ width: `${progress[i] ?? 0}%` }}
                            />
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => setPicking(true)}
                  >
                    <FolderIcon />
                    From Nimbus
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => file.current?.click()}
                  >
                    <CloudArrowUpIcon />
                    From this computer
                  </Button>
                  <input
                    ref={file}
                    type="file"
                    multiple
                    hidden
                    onChange={(e) => {
                      if (e.target.files)
                        setDevice([...device, ...e.target.files])
                      e.target.value = ""
                    }}
                  />
                </div>
              </section>

              <div className="flex flex-col gap-2">
                {options.email ? (
                  <Input
                    aria-label="Send to"
                    placeholder="Send to emails (separate with commas)"
                    value={emails}
                    onChange={(e) => setEmails(e.target.value)}
                    disabled={busy}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Email isn&apos;t set up on this Nimbus, so copy the link
                    after sending.
                  </p>
                )}
                {options.email && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={useLink}
                      disabled={busy || !people.length}
                      onChange={(e) => setLink(e.target.checked)}
                      className="size-4 accent-[var(--brand)]"
                    />
                    Also make a link to copy
                  </label>
                )}
              </div>

              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Title (optional)
                <Input
                  placeholder="e.g. Q3 numbers"
                  value={title}
                  maxLength={100}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={busy}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Message (optional)
                <textarea
                  placeholder="Shown on the download page and in the email"
                  value={note}
                  maxLength={2000}
                  rows={3}
                  onChange={(e) => setNote(e.target.value)}
                  disabled={busy}
                  className="rounded-md border border-input bg-input/30 px-3 py-2 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </label>
              <div className="grid grid-cols-3 gap-2 max-sm:grid-cols-1">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Lasts
                  <select
                    value={expiry}
                    onChange={(e) => setExpiry(Number(e.target.value))}
                    disabled={busy}
                    className={SELECT}
                  >
                    {days.map((d) => (
                      <option key={d} value={d}>
                        {d === 1 ? "1 day" : `${d} days`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Password
                  <Input
                    type="password"
                    autoComplete="new-password"
                    placeholder="Optional"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={busy}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Download limit
                  <Input
                    type="number"
                    min={1}
                    placeholder="None"
                    value={limit}
                    onChange={(e) => setLimit(e.target.value)}
                    disabled={busy}
                  />
                </label>
              </div>
              {options.maxBytes !== null && (
                <p className="text-xs text-muted-foreground">
                  Transfers here can be up to {formatBytes(options.maxBytes)}.
                  The files count against your storage until it expires.
                </p>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    if (draft.current) void discardTransfer(draft.current.id)
                    draft.current = null
                    onClose()
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={busy || !count || (!people.length && !useLink)}
                >
                  {busy && (
                    <CircleNotchIcon className="animate-spin motion-reduce:animate-none" />
                  )}
                  {busy ? "Sending…" : "Send"}
                </Button>
              </div>
            </form>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// My files and folders, one level at a time, with a box on each.
function NimbusPicker({
  chosen,
  onDone,
}: {
  chosen: Picked[]
  onDone: (p: Picked[]) => void
}) {
  const [path, setPath] = useState<{ id: string | null; name: string }[]>([
    { id: null, name: "My files" },
  ])
  const [sel, setSel] = useState(new Map(chosen.map((c) => [c.id, c])))
  const here = path[path.length - 1]
  const [loaded, setLoaded] = useState<{
    at: string | null
    items: Entry[]
  } | null>(null)
  const items = loaded?.at === here.id ? loaded.items : null
  useEffect(() => {
    let live = true
    pickItems(here.id).then(
      (r) => live && setLoaded({ at: here.id, items: r as Entry[] })
    )
    return () => {
      live = false
    }
  }, [here.id])

  const toggle = (i: Entry) => {
    const next = new Map(sel)
    if (next.has(i.id)) next.delete(i.id)
    else
      next.set(i.id, {
        id: i.id,
        name: i.name,
        kind: i.kind,
        mime: i.mime,
        size: i.size,
      })
    setSel(next)
  }

  return (
    <div className="flex flex-col gap-3">
      <nav
        aria-label="Location"
        className="-mx-1 flex flex-wrap items-center gap-0.5 text-sm"
      >
        {path.map((p, i) =>
          i === path.length - 1 ? (
            <span
              key={p.id ?? "root"}
              aria-current="location"
              className="truncate px-1 font-medium"
            >
              {p.name}
            </span>
          ) : (
            <span
              key={p.id ?? "root"}
              className="flex min-w-0 items-center gap-0.5"
            >
              <button
                type="button"
                onClick={() => setPath(path.slice(0, i + 1))}
                className="truncate rounded-md px-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {p.name}
              </button>
              <CaretRightIcon className="size-3 shrink-0 text-muted-foreground" />
            </span>
          )
        )}
      </nav>
      <div className="h-64 overflow-y-auto rounded-lg border">
        {items === null ? (
          <div className="flex flex-col gap-1 p-1" aria-label="Loading">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-9 animate-pulse rounded-md bg-muted/50 motion-reduce:animate-none"
              />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="grid h-full place-items-center px-6 text-center text-sm text-muted-foreground">
            Nothing in {here.name}.
          </p>
        ) : (
          <ul className="flex flex-col p-1">
            {items.map((i) => (
              <li key={i.id} className="flex items-center gap-1">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={sel.has(i.id)}
                  aria-label={`Select ${i.name}`}
                  onClick={() => toggle(i)}
                  className="grid size-9 shrink-0 place-items-center outline-none"
                >
                  <span
                    className={cn(
                      "grid size-4 place-items-center rounded-[4px] border border-input bg-background",
                      sel.has(i.id) && "border-primary bg-primary"
                    )}
                  >
                    {sel.has(i.id) && (
                      <CheckIcon
                        weight="bold"
                        className="size-3 text-primary-foreground"
                      />
                    )}
                  </span>
                </button>
                {i.kind === "folder" ? (
                  <button
                    type="button"
                    onClick={() =>
                      setPath([...path, { id: i.id, name: i.name }])
                    }
                    className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <FolderIcon
                      weight="fill"
                      className="size-4 shrink-0 text-file-folder"
                    />
                    <span className="flex-1 truncate">{i.name}</span>
                    <CaretRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  </button>
                ) : (
                  <span className="flex h-9 min-w-0 flex-1 items-center gap-2 px-2 text-sm">
                    <span className="flex-1 truncate">{i.name}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatBytes(i.size)}
                    </span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => onDone(chosen)}>
          Back
        </Button>
        <Button onClick={() => onDone([...sel.values()])}>
          Add {sel.size || ""}
        </Button>
      </div>
    </div>
  )
}

// "Send with Transfer" from anywhere in the app: one dialog, opened with the items.
const Ctx = createContext<{
  enabled: boolean
  send: (items: Picked[]) => void
}>({
  enabled: false,
  send: () => {},
})
export const useTransfer = () => useContext(Ctx)

export function TransferProvider({
  enabled,
  children,
}: {
  enabled: boolean
  children: React.ReactNode
}) {
  const [items, setItems] = useState<Picked[]>([])
  const [open, setOpen] = useState(false)
  const [setup, setSetup] = useState<Awaited<
    ReturnType<typeof transferSetup>
  > | null>(null)
  return (
    <Ctx.Provider
      value={{
        enabled,
        send: (picked) => {
          setItems(picked)
          setOpen(true)
          if (!setup) transferSetup().then(setSetup)
        },
      }}
    >
      {children}
      {enabled && setup && (
        <TransferDialog
          open={open}
          onClose={() => setOpen(false)}
          initial={items}
          options={setup.options}
          tusUrl={setup.tusUrl}
        />
      )}
    </Ctx.Provider>
  )
}

function RowIcon({
  kind,
  mime,
  name,
}: {
  kind: "file" | "folder"
  mime: string | null
  name: string
}) {
  const t = fileType(kind, mime, name)
  return (
    <t.icon
      weight={kind === "folder" ? "fill" : undefined}
      className={cn("size-4 shrink-0", t.color)}
    />
  )
}
