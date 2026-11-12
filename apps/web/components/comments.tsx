"use client"

import { Menu } from "@base-ui/react/menu"
import {
  ArrowCounterClockwiseIcon,
  ChatCircleIcon,
  CheckCircleIcon,
  DotsThreeIcon,
  FilePdfIcon,
  PlayIcon,
  SmileyIcon,
} from "@phosphor-icons/react"
import type {
  Comment,
  CommentPerson,
  CommentsResponse,
  CommentThread,
} from "@nimbus/shared/api"
import {
  MAX_COMMENT,
  REACTIONS,
  commentParts,
  decodeMentions,
  encodeMentions,
  formatAt,
  matchPeople,
  mentionQuery,
} from "@nimbus/shared/comments"
import { cn } from "cn"
import { Fragment, useCallback, useEffect, useRef, useState } from "react"

import {
  addComment,
  deleteComment,
  editComment,
  getComments,
  reactTo,
  resolveThread,
} from "@/app/(app)/comment-actions"
import { MENU_ITEM, MENU_POPUP } from "@/components/overlay-styles"
import { Button } from "@/components/ui/button"
import { UserAvatar } from "@/components/user-avatar"
import type { Item } from "@/lib/files"

const when = (iso: string) => {
  const s = (Date.now() - Date.parse(iso)) / 1000
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year:
      new Date(iso).getFullYear() === new Date().getFullYear()
        ? undefined
        : "numeric",
  })
}
const full = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })

// What the previewer is showing, for anchors: the playing video or audio, or the PDF frame.
const previewMedia = () =>
  document.querySelector<HTMLMediaElement>(
    "[data-preview] video, [data-preview] audio"
  )
const previewPdf = () =>
  document.querySelector<HTMLIFrameElement>("[data-preview] iframe[data-pdf]")

function jumpTo(c: Comment) {
  const media = previewMedia()
  if (c.atSeconds !== null && media) {
    media.currentTime = c.atSeconds
    void media.play().catch(() => {})
  }
  const pdf = previewPdf()
  if (c.page !== null && pdf) {
    const [base, hash = ""] = pdf.src.split("#")
    const keep = hash
      .split("&")
      .filter((p) => p && !p.startsWith("page="))
    pdf.src = `${base}#${[...keep, `page=${c.page}`].join("&")}`
  }
}

type Live = {
  data: CommentsResponse | null | undefined
  reload: () => void
}

// The file's threads, kept fresh by the server's comment stream while open.
function useComments(id: string): Live {
  const [loaded, setLoaded] = useState<{
    id: string
    data: CommentsResponse | null
  } | null>(null)
  const reload = useCallback(() => {
    getComments(id).then(
      (data) => setLoaded({ id, data }),
      () => {}
    )
  }, [id])
  useEffect(() => {
    reload()
    const es = new EventSource(`/api/v1/files/${id}/comments/events`)
    es.addEventListener("comment", reload)
    // A 404 or sign-out ends it; the browser would otherwise retry forever.
    es.onerror = () => es.readyState === EventSource.CLOSED && es.close()
    return () => es.close()
  }, [id, reload])
  return { data: loaded?.id === id ? loaded.data : undefined, reload }
}

// Threads on a file, with a composer. In the previewer (`anchors`), a new thread can point at the
// video's current time or a PDF page, and chips jump there.
export function Comments({
  item,
  anchors = false,
  className,
}: {
  item: Item
  anchors?: boolean
  className?: string
}) {
  const { data, reload } = useComments(item.id)
  const [showResolved, setShowResolved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (p: Promise<{ error?: string }>) => {
    const r = await p.catch(() => ({ error: "Couldn't reach Nimbus. Try again." }))
    setError(r.error ?? null)
    if (!r.error) reload()
    return !r.error
  }

  if (data === null) return null
  const open = data?.threads.filter((t) => !t.resolvedAt) ?? []
  const resolved = data?.threads.filter((t) => t.resolvedAt) ?? []
  const ctx = data && {
    fileId: item.id,
    data,
    run,
    anchors,
    nameOf: (id: string | null) =>
      data.people.find((p) => p.id === id)?.name,
  }

  return (
    <section
      aria-labelledby={`comments-${item.id}`}
      className={cn("flex flex-col gap-3", className)}
    >
      <div className="flex items-center gap-2">
        <h3 id={`comments-${item.id}`} className="text-sm font-medium">
          Comments
        </h3>
        {resolved.length > 0 && (
          <Button
            variant="ghost"
            size="xs"
            className="ml-auto text-muted-foreground"
            aria-pressed={showResolved}
            onClick={() => setShowResolved((s) => !s)}
          >
            {showResolved ? "Hide" : "Show"} {resolved.length} resolved
          </Button>
        )}
      </div>
      {!ctx ? (
        <span className="h-4 w-32 animate-pulse rounded bg-muted/60 motion-reduce:animate-none" />
      ) : (
        <>
          {!open.length && !showResolved && (
            <p className="text-xs text-muted-foreground">
              {resolved.length
                ? "Every thread is resolved."
                : "No comments yet. Start a thread for everyone who can open this file."}
            </p>
          )}
          {[...open, ...(showResolved ? resolved : [])].map((t) => (
            <Thread key={t.id} thread={t} {...ctx} />
          ))}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          {data.canComment && (
            <Composer
              people={data.people}
              anchors={anchors}
              placeholder="Add a comment… @ to mention"
              onSend={(body, at) =>
                run(addComment(item.id, { body, ...at }))
              }
            />
          )}
        </>
      )}
    </section>
  )
}

type Ctx = {
  fileId: string
  data: CommentsResponse
  run: (p: Promise<{ error?: string }>) => Promise<boolean>
  anchors: boolean
  nameOf: (id: string | null) => string | undefined
}

function Thread({ thread, ...ctx }: { thread: CommentThread } & Ctx) {
  const [replying, setReplying] = useState(false)
  const { data, run } = ctx
  const canResolve =
    data.canComment && (data.canModerate || thread.authorId === data.me)
  return (
    <article
      className={cn(
        "flex flex-col gap-3 rounded-xl border p-3",
        thread.resolvedAt && "bg-muted/30"
      )}
    >
      {thread.resolvedAt && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CheckCircleIcon className="size-3.5" />
          Resolved by {ctx.nameOf(thread.resolvedBy) ?? "someone"} ·{" "}
          {when(thread.resolvedAt)}
        </p>
      )}
      <One
        c={thread}
        {...ctx}
        resolve={
          canResolve
            ? () => run(resolveThread(thread.id, !thread.resolvedAt))
            : undefined
        }
        resolved={Boolean(thread.resolvedAt)}
      />
      {thread.replies.map((r) => (
        <One key={r.id} c={r} {...ctx} reply />
      ))}
      {data.canComment &&
        (replying ? (
          <Composer
            people={data.people}
            placeholder="Reply…"
            autoFocus
            onCancel={() => setReplying(false)}
            onSend={async (body) => {
              const ok = await run(
                addComment(ctx.fileId, { body, parentId: thread.id })
              )
              if (ok) setReplying(false)
              return ok
            }}
          />
        ) : (
          <Button
            variant="ghost"
            size="xs"
            className="self-start text-muted-foreground"
            onClick={() => setReplying(true)}
          >
            Reply
          </Button>
        ))}
    </article>
  )
}

function One({
  c,
  data,
  run,
  anchors,
  nameOf,
  reply = false,
  resolve,
  resolved,
}: { c: Comment; reply?: boolean; resolve?: () => void; resolved?: boolean } & Omit<Ctx, "fileId">) {
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const author = data.people.find((p) => p.id === c.authorId)
  const name = author?.name ?? "Someone"
  const mine = c.authorId === data.me
  const canDelete = data.canComment && (mine || data.canModerate)
  const anchor =
    c.atSeconds !== null
      ? { icon: PlayIcon, text: formatAt(c.atSeconds), label: `Jump to ${formatAt(c.atSeconds)}` }
      : c.page !== null
        ? { icon: FilePdfIcon, text: `Page ${c.page}`, label: `Go to page ${c.page}` }
        : null

  if (c.body === null)
    return (
      <p className="text-sm text-muted-foreground italic">Comment deleted</p>
    )

  return (
    <div className={cn("flex gap-2.5", reply && "pl-6")}>
      <span className="shrink-0">
        <UserAvatar name={name} image={author?.image} size={reply ? 24 : 28} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline gap-1.5">
          <span className="truncate text-sm font-medium">
            {mine ? "You" : name}
          </span>
          <time
            dateTime={c.createdAt}
            title={full(c.createdAt)}
            className="shrink-0 text-xs text-muted-foreground"
          >
            {when(c.createdAt)}
            {c.editedAt && " · edited"}
          </time>
          {(mine || canDelete || resolve) && data.canComment && !editing && (
            <Menu.Root>
              <Menu.Trigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="-my-1 ml-auto shrink-0"
                    aria-label={`Actions for ${mine ? "your" : `${name}'s`} comment`}
                  />
                }
              >
                <DotsThreeIcon weight="bold" />
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Positioner side="bottom" align="end" sideOffset={4}>
                  <Menu.Popup className={`z-[60] w-40 ${MENU_POPUP}`}>
                    {resolve && (
                      <Menu.Item className={MENU_ITEM} onClick={resolve}>
                        {resolved ? <ArrowCounterClockwiseIcon /> : <CheckCircleIcon />}
                        {resolved ? "Reopen" : "Resolve"}
                      </Menu.Item>
                    )}
                    {mine && (
                      <Menu.Item className={MENU_ITEM} onClick={() => setEditing(true)}>
                        Edit
                      </Menu.Item>
                    )}
                    {canDelete && (
                      <Menu.Item
                        className={cn(MENU_ITEM, "text-destructive")}
                        onClick={() => setConfirming(true)}
                      >
                        Delete
                      </Menu.Item>
                    )}
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.Root>
          )}
        </div>
        {anchor &&
          (anchors ? (
            <button
              type="button"
              onClick={() => jumpTo(c)}
              aria-label={anchor.label}
              className="flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-xs tabular-nums hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <anchor.icon weight="fill" className="size-3" />
              {anchor.text}
            </button>
          ) : (
            <span className="flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground tabular-nums">
              <anchor.icon weight="fill" className="size-3" />
              {anchor.text}
            </span>
          ))}
        {editing ? (
          <Composer
            people={data.people}
            initial={decodeMentions(c.body, (id) => nameOf(id))}
            autoFocus
            sendLabel="Save"
            onCancel={() => setEditing(false)}
            onSend={async (body) => {
              const ok = await run(editComment(c.id, body))
              if (ok) setEditing(false)
              return ok
            }}
          />
        ) : (
          <p className="text-sm break-words whitespace-pre-wrap">
            {commentParts(c.body, (id) => nameOf(id)).map((p, i) =>
              "mention" in p ? (
                <span key={i} className="rounded bg-primary/10 px-0.5 font-medium text-primary">
                  @{p.name}
                </span>
              ) : "link" in p ? (
                <a
                  key={i}
                  href={p.link}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="underline underline-offset-2 hover:text-primary"
                >
                  {p.link}
                </a>
              ) : (
                <Fragment key={i}>{p.text}</Fragment>
              )
            )}
          </p>
        )}
        {confirming && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span>Delete this comment?</span>
            <Button
              variant="destructive"
              size="xs"
              onClick={async () => {
                if (await run(deleteComment(c.id))) setConfirming(false)
              }}
            >
              Delete
            </Button>
            <Button variant="ghost" size="xs" onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </div>
        )}
        <Reactions c={c} data={data} run={run} />
      </div>
    </div>
  )
}

function Reactions({ c, data, run }: { c: Comment } & Pick<Ctx, "data" | "run">) {
  const toggle = (emoji: string, on: boolean) => run(reactTo(c.id, emoji, on))
  if (!c.reactions.length && !data.canComment) return null
  return (
    <div className="flex flex-wrap items-center gap-1">
      {c.reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          disabled={!data.canComment}
          aria-pressed={r.mine}
          aria-label={`${r.emoji} ${r.count}${r.mine ? ", including you" : ""}`}
          onClick={() => toggle(r.emoji, !r.mine)}
          className={cn(
            "flex h-6 items-center gap-1 rounded-full border px-1.5 text-xs tabular-nums transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
            r.mine ? "border-primary/40 bg-primary/10" : "hover:bg-muted"
          )}
        >
          <span aria-hidden>{r.emoji}</span>
          {r.count}
        </button>
      ))}
      {data.canComment && (
        <Menu.Root>
          <Menu.Trigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                className="rounded-full text-muted-foreground"
                aria-label="Add a reaction"
              />
            }
          >
            <SmileyIcon />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner side="top" align="start" sideOffset={4}>
              <Menu.Popup className={`z-[60] flex gap-0.5 ${MENU_POPUP}`}>
                {REACTIONS.map((e) => {
                  const mine = c.reactions.some((r) => r.emoji === e && r.mine)
                  return (
                    <Menu.Item
                      key={e}
                      aria-label={mine ? `Remove ${e}` : `React ${e}`}
                      className={cn(
                        "grid size-8 cursor-default place-items-center rounded-md text-base outline-none data-highlighted:bg-accent",
                        mine && "bg-primary/10"
                      )}
                      onClick={() => toggle(e, !mine)}
                    >
                      {e}
                    </Menu.Item>
                  )
                })}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      )}
    </div>
  )
}

// A textarea with @mention suggestions. ⌘/Ctrl+Enter sends.
function Composer({
  people,
  onSend,
  onCancel,
  initial = "",
  placeholder,
  autoFocus,
  sendLabel = "Send",
  anchors = false,
}: {
  people: CommentPerson[]
  onSend: (
    body: string,
    at: { atSeconds?: number; page?: number }
  ) => Promise<boolean>
  onCancel?: () => void
  initial?: string
  placeholder?: string
  autoFocus?: boolean
  sendLabel?: string
  anchors?: boolean
}) {
  const [text, setText] = useState(initial)
  const [caret, setCaret] = useState(0)
  const [pick, setPick] = useState(0)
  const [busy, setBusy] = useState(false)
  // An anchor offered from what the previewer shows; ticked, it goes with the comment.
  const [anchor, setAnchor] = useState<{ atSeconds?: number; page?: number } | null>(null)
  const [useAnchor, setUseAnchor] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  const mentionable = people.filter((p) => p.mentionable)
  const q = mentionQuery(text, caret)
  const matches = q ? matchPeople(mentionable, q.query) : []

  // Offer the video's time or a PDF page when the composer gets focus.
  function offerAnchor() {
    if (!anchors) return
    const media = previewMedia()
    if (media) return setAnchor({ atSeconds: Math.floor(media.currentTime) })
    if (previewPdf()) setAnchor((a) => a ?? { page: 1 })
  }

  function insert(p: CommentPerson) {
    if (!q) return
    const next = `${text.slice(0, q.start)}@${p.name} ${text.slice(caret)}`
    const at = q.start + p.name.length + 2
    setText(next)
    setCaret(at)
    requestAnimationFrame(() => {
      box.current?.setSelectionRange(at, at)
      box.current?.focus()
    })
  }

  async function send() {
    const body = encodeMentions(text.trim(), mentionable)
    if (!body || busy) return
    setBusy(true)
    const ok = await onSend(body, useAnchor && anchor ? anchor : {})
    setBusy(false)
    if (ok && !onCancel) {
      setText("")
      setUseAnchor(false)
      setAnchor(null)
    }
  }

  return (
    <div className="relative flex flex-col gap-2">
      <textarea
        ref={box}
        value={text}
        autoFocus={autoFocus}
        rows={2}
        maxLength={MAX_COMMENT}
        placeholder={placeholder}
        aria-label={placeholder?.replace("…", "") ?? "Comment"}
        aria-autocomplete="list"
        onFocus={offerAnchor}
        onChange={(e) => {
          setText(e.target.value)
          setCaret(e.target.selectionStart)
          setPick(0)
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={(e) => {
          if (matches.length) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault()
              const d = e.key === "ArrowDown" ? 1 : -1
              return setPick((i) => (i + d + matches.length) % matches.length)
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault()
              return insert(matches[pick])
            }
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void send()
          }
          if (e.key === "Escape" && onCancel) {
            e.stopPropagation()
            onCancel()
          }
        }}
        className="field-sizing-content max-h-48 min-h-16 w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
      />
      {matches.length > 0 && (
        <ul
          role="listbox"
          aria-label="People to mention"
          className={`absolute top-full left-0 z-10 mt-1 w-60 ${MENU_POPUP}`}
        >
          {matches.map((p, i) => (
            <li
              key={p.id}
              role="option"
              aria-selected={i === pick}
              onMouseDown={(e) => {
                e.preventDefault()
                insert(p)
              }}
              className={cn(MENU_ITEM, i === pick && "bg-accent")}
            >
              <UserAvatar name={p.name} image={p.image} size={20} />
              <span className="truncate">{p.name}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {anchor && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={useAnchor}
              onChange={(e) => {
                if (e.target.checked) offerAnchor()
                setUseAnchor(e.target.checked)
              }}
              className="accent-primary"
            />
            {anchor.atSeconds !== undefined ? (
              `At ${formatAt(anchor.atSeconds)}`
            ) : (
              <>
                Page
                <input
                  type="number"
                  min={1}
                  value={anchor.page}
                  aria-label="Page number"
                  onChange={(e) => {
                    setAnchor({ page: Math.max(1, Number(e.target.value) || 1) })
                    setUseAnchor(true)
                  }}
                  className="h-6 w-14 rounded border border-input bg-transparent px-1.5 text-xs text-foreground tabular-nums"
                />
              </>
            )}
          </label>
        )}
        <span className="ml-auto flex gap-2">
          {onCancel && (
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button size="sm" disabled={!text.trim() || busy} onClick={send}>
            {sendLabel}
          </Button>
        </span>
      </div>
    </div>
  )
}

// A comment count for list rows; nothing at zero.
export function CommentCount({ n, className }: { n?: number; className?: string }) {
  if (!n) return null
  return (
    <span
      title={`${n} open comment thread${n === 1 ? "" : "s"}`}
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 text-[11px] leading-none text-muted-foreground tabular-nums",
        className
      )}
    >
      <ChatCircleIcon aria-hidden className="size-3" />
      <span className="sr-only">Open comments:</span>
      {n}
    </span>
  )
}
