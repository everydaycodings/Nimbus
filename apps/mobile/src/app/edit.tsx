// The text editor: .txt, .md and code up to 1 MB. Save makes a new version; if the server's moved on it offers Keep both.
import type { PreviewResponse } from "@nimbus/shared/api"
import { router, useFocusEffect, useLocalSearchParams } from "expo-router"
import { ArrowLeft, ArrowUUpLeft, ArrowUUpRight, CaretDown, CaretUp, Eye, MagnifyingGlass, PencilSimple, X } from "phosphor-react-native"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ActivityIndicator, BackHandler, KeyboardAvoidingView, TextInput, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { WebView, type WebViewMessageEvent } from "react-native-webview"

import { Actions, Frame } from "@/components/dialog"
import { useSnack } from "@/components/snackbar"
import { Bar, Button, IconButton, Text, type InputRef } from "@/components/ui"
import { ApiError, errorText } from "@/lib/api"
import { isOnline } from "@/lib/connectivity"
import { CHANGED, currentOf, uploadText } from "@/lib/editor-save"
import { EDIT_MAX, changedSince, commit, findAll, history, readOnly, redo, shown, undo, type History } from "@/lib/editor-rules"
import { fetchToCache } from "@/lib/file-cache"
import { useApi, useDetails } from "@/lib/files"
import { enqueue } from "@/lib/offline-queue"
import { toBase64 } from "@/lib/preview-rules"
import { c, font, radius, type } from "@/lib/theme"

const TYPING_PAUSE_MS = 600
const POLL_MS = 1000
const POLL_TRIES = 30
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")

type Ask = "leave" | "changed" | null

export default function Edit() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const api = useApi()
  const snack = useSnack()
  const inset = useSafeAreaInsets()
  const details = useDetails(id)
  const item = details.data?.item ?? null
  const parentId = details.data?.details.parentId ?? null

  // What was loaded, which version it was, and what's been saved since.
  const [saved, setSaved] = useState<string | null>(null)
  const [text, setText] = useState("")
  const [hist, setHist] = useState<History>(() => history(""))
  const [opened, setOpened] = useState<string | null | undefined>(undefined)
  const [failed, setFailed] = useState<string | null>(null)
  const [big, setBig] = useState(false)
  const [busy, setBusy] = useState(false)
  const [ask, setAsk] = useState<Ask>(null)
  const [preview, setPreview] = useState(false)
  const [finding, setFinding] = useState(false)
  const [query, setQuery] = useState("")
  const [at, setAt] = useState(0)
  const [jump, setJump] = useState<{ start: number; end: number } | undefined>()
  const input = useRef<InputRef>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const started = useRef(false)

  const dirty = saved !== null && text !== saved
  const markdown = !!item && /\.(md|markdown)$/i.test(item.name)

  // Loads once the details are in: the cached copy, or the whole file; past 1 MB only the first MB, read-only.
  useEffect(() => {
    if (!item || started.current) return
    started.current = true
    ;(async () => {
      const url = async () => (await api.get<PreviewResponse>(`/items/${item.id}/preview`)).url
      let body: string
      if (readOnly(item.size)) {
        setBig(true)
        const r = await fetch(await url(), { headers: { Range: `bytes=0-${EDIT_MAX - 1}` } })
        body = (await r.text()).slice(0, EDIT_MAX)
      } else body = await (await fetchToCache(api.id, item.id, item.version, url)).text()
      setOpened(item.version)
      setSaved(body)
      setText(body)
      setHist(history(body))
    })().catch((e) => setFailed(errorText(e)))
  }, [item, api])

  const flush = useCallback(
    (t: string) => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      setHist((h) => commit(h, t))
    },
    []
  )
  const typed = (t: string) => {
    setText(t)
    setJump(undefined)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => flush(t), TYPING_PAUSE_MS)
  }
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])
  const step = (go: (h: History) => History) => {
    const h = go(commit(hist, text))
    setHist(h)
    setText(shown(h))
    if (timer.current) clearTimeout(timer.current)
  }

  const matches = useMemo(() => (finding ? findAll(text, query) : []), [finding, text, query])
  const goTo = (n: number) => {
    if (!matches.length) return
    const i = (n + matches.length) % matches.length
    setAt(i)
    setJump({ start: matches[i], end: matches[i] + query.length })
    input.current?.focus()
  }

  // ---- Saving ----

  // Waits for the upload to land so the next save compares against the version this one made.
  const settle = async (before: string | null) => {
    for (let i = 0; i < POLL_TRIES; i++) {
      await new Promise((r) => setTimeout(r, POLL_MS))
      const now = (await currentOf(api.account, id).catch(() => null))?.item
      if (now && now.version !== before) return setOpened(now.version)
    }
    setOpened(undefined)
  }

  const save = async (as: "version" | "copy" = "version") => {
    if (!item || busy) return false
    setBusy(true)
    try {
      const body = text
      const queue = () => {
        enqueue(api.id, { op: "saveText", id: item.id, parentId, name: item.name, text: body, base: opened ?? item.version }, `Save “${item.name}”`)
        snack({ text: "Will sync when online." })
        setSaved(body)
        return "queued" as const
      }
      if (!isOnline()) return queue()
      let now
      try {
        now = (await currentOf(api.account, id)).item
      } catch (e) {
        if (e instanceof ApiError && e.status === 0) return queue()
        throw e
      }
      if (!now || now.trashedAt) throw new Error("This file is in the trash or gone, so it can't be saved.")
      if (as === "version" && opened !== undefined && changedSince(opened, now.version)) {
        setAsk("changed")
        return false
      }
      await uploadText(api.account, parentId, now.name, body, as)
      setSaved(body)
      snack({ text: as === "copy" ? "Saved as a copy." : "Saving a new version…" })
      if (as === "version") await settle(now.version)
      return true
    } catch (e) {
      snack({ text: e instanceof Error && !(e instanceof ApiError) ? e.message : errorText(e), error: true })
      return false
    } finally {
      setBusy(false)
    }
  }

  const back = useCallback(() => (dirty ? setAsk("leave") : router.back()), [dirty])
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        back()
        return true
      })
      return () => sub.remove()
    }, [back])
  )

  // ---- Markdown preview: the previewer's own page, fed from the text in the editor ----

  const page = useMemo(() => {
    if (!preview || !item) return null
    const meta = `<head><meta name="nimbus" content="${esc(JSON.stringify({ name: item.name, size: new TextEncoder().encode(text).length, top: 0, bottom: inset.bottom }))}">`
    return { html: (require("@/lib/viewers/text").default as string).replace("<head>", () => meta), baseUrl: "about:blank" }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the text is frozen while previewing
  }, [preview, item?.name])
  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const m = JSON.parse(e.nativeEvent.data)
      if (m.t !== "read") return
      const bytes = new TextEncoder().encode(text).subarray(m.offset, m.offset + m.length)
      web.current?.injectJavaScript(`__reply(${m.id},"${toBase64(bytes)}");true;`)
    } catch {}
  }
  const web = useRef<WebView>(null)

  const loading = !failed && saved === null
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: c.background }}>
      <Bar>
        <IconButton icon={ArrowLeft} label="Back" onPress={back} />
        <View style={{ flex: 1 }}>
          <Text variant="titleSmall" numberOfLines={1} accessibilityRole="header">{item?.name ?? "Edit"}</Text>
          <Text variant="caption" color={c.mutedForeground}>{big ? "Read-only" : dirty ? "Unsaved changes" : "Saved"}</Text>
        </View>
        {!big && !preview && (
          <>
            <IconButton icon={ArrowUUpLeft} label="Undo" onPress={() => step(undo)} color={hist.at > 0 || dirty ? c.foreground : c.mutedForeground} />
            <IconButton icon={ArrowUUpRight} label="Redo" onPress={() => step(redo)} color={hist.at < hist.stack.length - 1 ? c.foreground : c.mutedForeground} />
          </>
        )}
        {!preview && <IconButton icon={MagnifyingGlass} label="Find" onPress={() => setFinding((f) => !f)} />}
        {markdown && <IconButton icon={preview ? PencilSimple : Eye} label={preview ? "Edit" : "Preview"} onPress={() => setPreview((p) => !p)} />}
        {!big && <View style={{ marginRight: 8 }}><Button label="Save" onPress={async () => (await save()) === "queued" && router.back()} busy={busy} disabled={!dirty} /></View>}
      </Bar>

      {finding && !preview && (
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingBottom: 8, gap: 4 }}>
          <TextInput
            value={query}
            onChangeText={(q) => {
              setQuery(q)
              setAt(0)
            }}
            onSubmitEditing={() => goTo(at + 1)}
            autoFocus
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            placeholder="Find in this file"
            accessibilityLabel="Find in this file"
            placeholderTextColor={c.mutedForeground}
            selectionColor={c.brand}
            cursorColor={c.brand}
            style={[type.body, { flex: 1, minHeight: 44, color: c.foreground, borderWidth: 1, borderColor: c.input, borderRadius: radius.control, paddingHorizontal: 12 }]}
          />
          <Text variant="caption" color={c.mutedForeground} style={{ minWidth: 48, textAlign: "center", fontVariant: ["tabular-nums"] }}>
            {query ? (matches.length ? `${at + 1} of ${matches.length}` : "None") : ""}
          </Text>
          <IconButton icon={CaretUp} label="Previous match" onPress={() => goTo(at - 1)} />
          <IconButton icon={CaretDown} label="Next match" onPress={() => goTo(at + 1)} />
          <IconButton icon={X} label="Close find" onPress={() => setFinding(false)} />
        </View>
      )}

      {big && (
        <View style={{ marginHorizontal: 16, marginBottom: 8, padding: 12, borderRadius: radius.control, backgroundColor: c.card, borderWidth: 1, borderColor: c.border }}>
          <Text variant="bodySmall" color={c.mutedForeground}>This file is over 1 MB, so it opens read-only here. Showing the first 1 MB.</Text>
        </View>
      )}

      {failed ? (
        <View style={{ padding: 24, gap: 12 }}>
          <Text color={c.destructive}>{failed}</Text>
          <Button variant="outlined" label="Back" onPress={() => router.back()} />
        </View>
      ) : loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={c.mutedForeground} accessibilityLabel="Loading" />
        </View>
      ) : preview && page ? (
        <WebView
          ref={web as never}
          source={page}
          originWhitelist={["*"]}
          onMessage={onMessage}
          onShouldStartLoadWithRequest={(r) => r.url === "about:blank" || r.url.startsWith("data:") || r.url.startsWith("blob:")}
          allowFileAccess={false}
          domStorageEnabled={false}
          cacheEnabled={false}
          incognito
          mixedContentMode="never"
          overScrollMode="never"
          textZoom={100}
          style={{ flex: 1, backgroundColor: c.background }}
        />
      ) : (
        <TextInput
          ref={input}
          value={text}
          onChangeText={typed}
          selection={jump}
          onSelectionChange={() => jump && setJump(undefined)}
          multiline
          editable={!big}
          scrollEnabled
          textAlignVertical="top"
          autoCorrect={false}
          autoCapitalize="none"
          spellCheck={false}
          accessibilityLabel="File contents"
          selectionColor={c.brand}
          cursorColor={c.brand}
          style={{ flex: 1, color: c.foreground, fontFamily: font.mono, fontSize: 14, lineHeight: 21, paddingHorizontal: 16, paddingTop: 8, paddingBottom: inset.bottom + 16 }}
        />
      )}

      {ask === "leave" && (
        <Frame title="Save your changes?" onClose={() => setAsk(null)}>
          <Text color={c.mutedForeground}>Your edits to “{item?.name}” haven't been saved.</Text>
          <Actions>
            <Button variant="text" label="Keep editing" onPress={() => setAsk(null)} />
            <Button variant="text" danger label="Discard" onPress={() => router.back()} />
            <Button
              variant="text"
              label="Save"
              onPress={async () => {
                setAsk(null)
                if (await save()) router.back()
              }}
            />
          </Actions>
        </Frame>
      )}
      {ask === "changed" && (
        <Frame title="Changed on the server" onClose={() => setAsk(null)}>
          <Text color={c.mutedForeground}>{CHANGED} Saving over it would replace the newer edit.</Text>
          <Actions>
            <Button variant="text" danger label="Discard mine" onPress={() => router.back()} />
            <Button
              variant="text"
              label="Keep both"
              onPress={async () => {
                setAsk(null)
                await save("copy")
              }}
            />
          </Actions>
        </Frame>
      )}
    </KeyboardAvoidingView>
  )
}
