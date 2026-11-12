// A file's comment threads, from Details, the file sheet, the previewer's bar or a notification. In the
// previewer, a new thread can take the video's time or a PDF page, and the chips jump back there.
import type { Comment, CommentPerson, CommentsResponse, CommentThread, NewComment } from "@nimbus/shared/api"
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
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { router, useLocalSearchParams } from "expo-router"
import { ArrowCounterClockwise, ArrowLeft, ArrowUp, CheckCircle, DotsThreeVertical, FilePdf, PencilSimple, Play, Smiley, Trash, X } from "phosphor-react-native"
import { useRef, useState, type ComponentRef } from "react"
import { KeyboardAvoidingView, Linking, Pressable, ScrollView, TextInput, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Avatar } from "@/components/avatar"
import { ConfirmDialog } from "@/components/dialog"
import { Loaded } from "@/components/page"
import { Sheet, SheetDivider, SheetRow } from "@/components/sheet"
import { useSnack } from "@/components/snackbar"
import { Bar, Button, IconButton, Text } from "@/components/ui"
import { errorText } from "@/lib/api"
import { anchorTarget } from "@/lib/comment-anchor"
import { useApi } from "@/lib/files"
import { c, radius, type } from "@/lib/theme"
import { since } from "@/lib/time"

type Mode = { kind: "reply"; thread: CommentThread } | { kind: "edit"; comment: Comment } | null
type Ask = { kind: "menu"; comment: Comment; thread: CommentThread } | { kind: "delete"; comment: Comment } | null

export default function Comments() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>()
  const api = useApi()
  const client = useQueryClient()
  const snack = useSnack()
  const inset = useSafeAreaInsets()
  const key = [api.id, "comments", id]
  // ponytail: polls while open instead of the server's event stream; switch to SSE if 8 s feels slow.
  const q = useQuery({
    queryKey: key,
    queryFn: () => api.get<CommentsResponse>(`/files/${id}/comments`),
    refetchInterval: 8000,
  })
  const [showResolved, setShowResolved] = useState(false)
  const [mode, setMode] = useState<Mode>(null)
  const [ask, setAsk] = useState<Ask>(null)
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null)
  const target = anchorTarget(id)

  const run = async (task: () => Promise<unknown>) => {
    try {
      await task()
      await client.invalidateQueries({ queryKey: key })
      // The list rows' counts and the Activity feed move too.
      void client.invalidateQueries({ queryKey: [api.id, "item", id] })
      return true
    } catch (e) {
      snack({ text: errorText(e), error: true })
      return false
    }
  }

  const jump = (cm: Comment) => {
    if (!target) return
    if (cm.atSeconds !== null && target.seek) target.seek(cm.atSeconds)
    else if (cm.page !== null && target.page) target.page(cm.page)
    else return
    router.back()
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: c.background }}>
      <Bar>
        <IconButton icon={ArrowLeft} label="Back" onPress={() => router.back()} />
        <View style={{ flex: 1 }}>
          <Text variant="title" numberOfLines={1} accessibilityRole="header">Comments</Text>
          {name && <Text variant="caption" color={c.mutedForeground} numberOfLines={1}>{name}</Text>}
        </View>
      </Bar>
      <Loaded query={q}>
        {(data) => {
          const nameOf = (uid: string | null) => data.people.find((p) => p.id === uid)?.name
          const open = data.threads.filter((t) => !t.resolvedAt)
          const resolved = data.threads.filter((t) => t.resolvedAt)
          return (
            <>
              <ScrollView
                ref={scroll}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ alignSelf: "center", width: "100%", maxWidth: 640, padding: 16, gap: 12 }}
              >
                {!open.length && (
                  <Text color={c.mutedForeground} style={{ paddingVertical: 24, textAlign: "center" }}>
                    {resolved.length ? "Every thread is resolved." : "No comments yet. Start a thread for everyone who can open this file."}
                  </Text>
                )}
                {[...open, ...(showResolved ? resolved : [])].map((t) => (
                  <View
                    key={t.id}
                    style={{ borderWidth: 1, borderColor: c.border, borderRadius: radius.card, padding: 12, gap: 12, backgroundColor: t.resolvedAt ? c.card : undefined }}
                  >
                    {t.resolvedAt && (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <CheckCircle size={14} color={c.mutedForeground} />
                        <Text variant="caption" color={c.mutedForeground}>
                          Resolved by {nameOf(t.resolvedBy) ?? "someone"} · {since(t.resolvedAt)}
                        </Text>
                      </View>
                    )}
                    {[t, ...t.replies].map((cm, i) => (
                      <One
                        key={cm.id}
                        c={cm}
                        reply={i > 0}
                        data={data}
                        nameOf={nameOf}
                        onJump={target && ((cm.atSeconds !== null && target.seek) || (cm.page !== null && target.page)) ? () => jump(cm) : undefined}
                        onMenu={data.canComment ? () => setAsk({ kind: "menu", comment: cm, thread: t }) : undefined}
                        onReact={(emoji, on) => run(() => api.put(`/comments/${cm.id}/reactions`, { emoji, on }))}
                      />
                    ))}
                    {data.canComment && (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => setMode({ kind: "reply", thread: t })}
                        style={{ alignSelf: "flex-start", minHeight: 40, justifyContent: "center", paddingHorizontal: 4 }}
                      >
                        <Text variant="label" color={c.mutedForeground}>Reply</Text>
                      </Pressable>
                    )}
                  </View>
                ))}
                {resolved.length > 0 && (
                  <View style={{ alignSelf: "flex-start" }}>
                    <Button
                      variant="text"
                      label={`${showResolved ? "Hide" : "Show"} ${resolved.length} resolved`}
                      onPress={() => setShowResolved((s) => !s)}
                    />
                  </View>
                )}
              </ScrollView>
              {data.canComment && (
                <Composer
                  key={mode?.kind === "edit" ? mode.comment.id : "new"}
                  people={data.people}
                  mode={mode}
                  bottom={inset.bottom}
                  initial={mode?.kind === "edit" && mode.comment.body ? decodeMentions(mode.comment.body, (u) => nameOf(u)) : ""}
                  replyTo={mode?.kind === "reply" ? (mode.thread.authorId === data.me ? "your comment" : (nameOf(mode.thread.authorId) ?? "the thread")) : undefined}
                  anchor={!mode && target ? target : null}
                  onCancel={() => setMode(null)}
                  onSend={async (body, at) => {
                    const ok =
                      mode?.kind === "edit"
                        ? await run(() => api.patch(`/comments/${mode.comment.id}`, { body }))
                        : await run(() =>
                            api.post(`/files/${id}/comments`, { body, ...(mode?.kind === "reply" ? { parentId: mode.thread.id } : at) } satisfies NewComment)
                          )
                    if (ok) {
                      if (!mode) setTimeout(() => scroll.current?.scrollToEnd(), 300)
                      setMode(null)
                    }
                    return ok
                  }}
                />
              )}
              {ask?.kind === "menu" && (
                <Sheet onClose={() => setAsk(null)}>
                  <View style={{ flexDirection: "row", justifyContent: "space-around", paddingHorizontal: 12, paddingVertical: 8 }}>
                    {REACTIONS.map((e) => {
                      const mine = ask.comment.reactions.some((r) => r.emoji === e && r.mine)
                      return (
                        <Pressable
                          key={e}
                          accessibilityRole="button"
                          accessibilityLabel={mine ? `Remove ${e}` : `React ${e}`}
                          accessibilityState={{ selected: mine }}
                          onPress={() => {
                            setAsk(null)
                            void run(() => api.put(`/comments/${ask.comment.id}/reactions`, { emoji: e, on: !mine }))
                          }}
                          style={{ width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: mine ? c.brandWash : c.muted }}
                        >
                          <Text style={{ fontSize: 22, lineHeight: 28 }}>{e}</Text>
                        </Pressable>
                      )
                    })}
                  </View>
                  {ask.comment.body !== null && <SheetDivider />}
                  {ask.comment.id === ask.thread.id && (data.canModerate || ask.thread.authorId === data.me) && (
                    <SheetRow
                      label={ask.thread.resolvedAt ? "Reopen" : "Resolve"}
                      icon={ask.thread.resolvedAt ? <ArrowCounterClockwise size={22} color={c.foreground} /> : <CheckCircle size={22} color={c.foreground} />}
                      onPress={() => run(() => api.patch(`/comments/${ask.thread.id}`, { resolved: !ask.thread.resolvedAt }))}
                    />
                  )}
                  {ask.comment.authorId === data.me && ask.comment.body !== null && (
                    <SheetRow label="Edit" icon={<PencilSimple size={22} color={c.foreground} />} onPress={() => setMode({ kind: "edit", comment: ask.comment })} />
                  )}
                  {(ask.comment.authorId === data.me || data.canModerate) && ask.comment.body !== null && (
                    <SheetRow label="Delete" danger icon={<Trash size={22} color={c.destructive} />} onPress={() => setAsk({ kind: "delete", comment: ask.comment })} />
                  )}
                </Sheet>
              )}
              {ask?.kind === "delete" && (
                <ConfirmDialog
                  title="Delete this comment?"
                  body="Everyone who can open the file stops seeing it. Replies stay."
                  confirm="Delete"
                  onClose={() => setAsk(null)}
                  onConfirm={() => {
                    setAsk(null)
                    void run(() => api.del(`/comments/${ask.comment.id}`))
                  }}
                />
              )}
            </>
          )
        }}
      </Loaded>
    </KeyboardAvoidingView>
  )
}

function One({
  c: cm,
  reply,
  data,
  nameOf,
  onJump,
  onMenu,
  onReact,
}: {
  c: Comment
  reply: boolean
  data: CommentsResponse
  nameOf: (id: string | null) => string | undefined
  onJump?: () => void
  onMenu?: () => void
  onReact: (emoji: string, on: boolean) => void
}) {
  const api = useApi()
  if (cm.body === null)
    return (
      <Text color={c.mutedForeground} style={{ fontStyle: "italic" }}>
        Comment deleted
      </Text>
    )
  const author = data.people.find((p) => p.id === cm.authorId)
  const name = cm.authorId === data.me ? "You" : (author?.name ?? "Someone")
  const anchor = cm.atSeconds !== null ? { icon: Play, text: formatAt(cm.atSeconds) } : cm.page !== null ? { icon: FilePdf, text: `Page ${cm.page}` } : null
  return (
    <View style={{ flexDirection: "row", gap: 10, paddingLeft: reply ? 24 : 0 }}>
      <Avatar account={api.account} name={author?.name ?? "?"} image={author?.image ?? null} size={reply ? 24 : 32} />
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 24 }}>
          <Text variant="label" numberOfLines={1} style={{ flexShrink: 1 }}>{name}</Text>
          <Text variant="caption" color={c.mutedForeground}>
            {since(cm.createdAt)}
            {cm.editedAt ? " · edited" : ""}
          </Text>
          <View style={{ flex: 1 }} />
          {onMenu && (
            <View style={{ margin: -12 }}>
              <IconButton icon={DotsThreeVertical} label={`Actions for ${name === "You" ? "your" : `${name}'s`} comment`} onPress={onMenu} color={c.mutedForeground} />
            </View>
          )}
        </View>
        {anchor && (
          <Pressable
            disabled={!onJump}
            onPress={onJump}
            accessibilityRole={onJump ? "button" : undefined}
            accessibilityLabel={onJump ? `Go to ${anchor.text}` : anchor.text}
            style={{ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: onJump ? c.brand : c.border, borderRadius: 999, paddingHorizontal: 10, minHeight: 28 }}
          >
            <anchor.icon size={12} weight="fill" color={onJump ? c.brand : c.mutedForeground} />
            <Text variant="caption" color={onJump ? c.brand : c.mutedForeground} style={{ fontVariant: ["tabular-nums"] }}>{anchor.text}</Text>
          </Pressable>
        )}
        <Text selectable>
          {commentParts(cm.body, (id) => nameOf(id)).map((p, i) =>
            "mention" in p ? (
              <Text key={i} variant="label" color={c.brand}>@{p.name}</Text>
            ) : "link" in p ? (
              <Text key={i} color={c.brand} style={{ textDecorationLine: "underline" }} onPress={() => void Linking.openURL(p.link)} accessibilityRole="link">
                {p.link}
              </Text>
            ) : (
              p.text
            )
          )}
        </Text>
        {cm.reactions.length > 0 && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 2 }}>
            {cm.reactions.map((r) => (
              <Pressable
                key={r.emoji}
                disabled={!data.canComment}
                onPress={() => onReact(r.emoji, !r.mine)}
                accessibilityRole="button"
                accessibilityState={{ selected: r.mine }}
                accessibilityLabel={`${r.emoji} ${r.count}${r.mine ? ", including you" : ""}`}
                style={{ flexDirection: "row", alignItems: "center", gap: 4, minHeight: 32, paddingHorizontal: 10, borderRadius: 16, borderWidth: 1, borderColor: r.mine ? c.brand : c.border, backgroundColor: r.mine ? c.brandWash : undefined }}
              >
                <Text>{r.emoji}</Text>
                <Text variant="caption" style={{ fontVariant: ["tabular-nums"] }}>{r.count}</Text>
              </Pressable>
            ))}
            {data.canComment && onMenu && (
              <Pressable accessibilityRole="button" accessibilityLabel="Add a reaction" onPress={onMenu} style={{ minHeight: 32, minWidth: 32, alignItems: "center", justifyContent: "center" }}>
                <Smiley size={18} color={c.mutedForeground} />
              </Pressable>
            )}
          </View>
        )}
      </View>
    </View>
  )
}

// Pinned under the threads: a new thread, a reply or an edit, with @mention suggestions above it.
function Composer({
  people,
  mode,
  initial,
  replyTo,
  anchor,
  bottom,
  onSend,
  onCancel,
}: {
  people: CommentPerson[]
  mode: Mode
  initial: string
  replyTo?: string
  anchor: ReturnType<typeof anchorTarget>
  bottom: number
  onSend: (body: string, at: { atSeconds?: number; page?: number }) => Promise<boolean>
  onCancel: () => void
}) {
  const account = useApi().account
  const [text, setText] = useState(initial)
  const [caret, setCaret] = useState(initial.length)
  const [busy, setBusy] = useState(false)
  const [at, setAt] = useState<{ atSeconds?: number; page?: number } | null>(null)
  const input = useRef<ComponentRef<typeof TextInput>>(null)
  const mentionable = people.filter((p) => p.mentionable)
  const mq = mentionQuery(text, caret)
  const matches = mq ? matchPeople(mentionable, mq.query) : []

  const pick = (p: CommentPerson) => {
    if (!mq) return
    setText(`${text.slice(0, mq.start)}@${p.name} ${text.slice(caret)}`)
    setCaret(mq.start + p.name.length + 2)
  }

  const send = async () => {
    const body = encodeMentions(text.trim(), mentionable)
    if (!body || busy) return
    setBusy(true)
    const ok = await onSend(body, at ?? {})
    setBusy(false)
    if (ok) {
      setText("")
      setAt(null)
      input.current?.blur()
    }
  }

  const toggleAnchor = () => {
    if (at) return setAt(null)
    if (anchor?.time) setAt({ atSeconds: Math.floor(anchor.time()) })
    else if (anchor?.page) setAt({ page: 1 })
  }

  return (
    <View style={{ borderTopWidth: 1, borderColor: c.border, backgroundColor: c.background, paddingBottom: bottom + 8 }}>
      {matches.length > 0 && (
        <View accessibilityLabel="People to mention" style={{ borderBottomWidth: 1, borderColor: c.border }}>
          {matches.map((p) => (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              accessibilityLabel={`Mention ${p.name}`}
              android_ripple={{ color: c.ripple }}
              onPress={() => pick(p)}
              style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48, paddingHorizontal: 16 }}
            >
              <Avatar account={account} name={p.name} image={p.image} size={24} />
              <Text numberOfLines={1}>{p.name}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {(mode || replyTo) && (
        <View style={{ flexDirection: "row", alignItems: "center", paddingLeft: 16, minHeight: 40 }}>
          <Text variant="caption" color={c.mutedForeground} style={{ flex: 1 }} numberOfLines={1}>
            {mode?.kind === "edit" ? "Editing your comment" : `Replying to ${replyTo}`}
          </Text>
          <IconButton icon={X} label={mode?.kind === "edit" ? "Stop editing" : "Stop replying"} onPress={onCancel} color={c.mutedForeground} />
        </View>
      )}
      {anchor && (anchor.time || anchor.page) && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 8 }}>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: !!at }}
            onPress={toggleAnchor}
            style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: at ? c.brand : c.border, backgroundColor: at ? c.brandWash : undefined }}
          >
            {anchor.time ? <Play size={12} weight="fill" color={at ? c.brand : c.mutedForeground} /> : <FilePdf size={14} color={at ? c.brand : c.mutedForeground} />}
            <Text variant="caption" color={at ? c.brand : c.mutedForeground}>
              {at?.atSeconds !== undefined ? `At ${formatAt(at.atSeconds)}` : at?.page !== undefined ? "On page" : anchor.time ? "At the current time" : "On a page"}
            </Text>
          </Pressable>
          {at?.page !== undefined && (
            <TextInput
              value={String(at.page)}
              onChangeText={(v) => setAt({ page: Math.max(1, Number(v.replace(/\D/g, "")) || 1) })}
              keyboardType="number-pad"
              accessibilityLabel="Page number"
              selectionColor={c.brand}
              style={[type.bodySmall, { color: c.foreground, minWidth: 56, minHeight: 36, borderWidth: 1, borderColor: c.input, borderRadius: radius.control, paddingHorizontal: 10 }]}
            />
          )}
        </View>
      )}
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 12, paddingTop: 8 }}>
        <TextInput
          ref={input}
          value={text}
          autoFocus={!!mode}
          multiline
          maxLength={MAX_COMMENT}
          placeholder={mode?.kind === "reply" ? "Reply…" : "Add a comment… @ to mention"}
          placeholderTextColor={c.mutedForeground}
          selectionColor={c.brand}
          cursorColor={c.brand}
          accessibilityLabel={mode?.kind === "reply" ? "Reply" : "Comment"}
          onChangeText={setText}
          onSelectionChange={(e) => setCaret(e.nativeEvent.selection.end)}
          style={[type.body, { flex: 1, maxHeight: 140, minHeight: 48, color: c.foreground, borderWidth: 1, borderColor: c.input, borderRadius: radius.control, paddingHorizontal: 14, paddingVertical: 12 }]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={mode?.kind === "edit" ? "Save" : "Send"}
          accessibilityState={{ disabled: !text.trim() || busy, busy }}
          disabled={!text.trim() || busy}
          onPress={send}
          style={{ width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: c.primary, opacity: !text.trim() || busy ? 0.4 : 1 }}
        >
          <ArrowUp size={22} weight="bold" color={c.primaryForeground} />
        </Pressable>
      </View>
    </View>
  )
}
