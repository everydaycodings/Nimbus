// The PDF editor: the previewer's pdf.js page in edit mode (viewer/pdf-edit.ts) under a native top bar and toolbar.
// Marks are saved as real PDF annotations. Save makes a new version, Save as copy a new file; if the server's moved
// on it asks first, and with no connection the save waits in the change queue.
import type { PreviewResponse, SignatureKind, SignaturesResponse } from "@nimbus/shared/api"
import { router, useFocusEffect, useLocalSearchParams } from "expo-router"
import { CopySimple, Signature, ArrowUUpLeft, ArrowUUpRight, X } from "phosphor-react-native"
import { Directory, File, Paths } from "expo-file-system"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ActivityIndicator, BackHandler, View } from "react-native"
import { WebView, type WebViewMessageEvent } from "react-native-webview"

import { Actions, Frame } from "@/components/dialog"
import { PdfEditToolbar } from "@/components/pdf-edit-toolbar"
import { SignatureSheet } from "@/components/pdf-signature-sheet"
import { Sheet, SheetRow } from "@/components/sheet"
import { useSnack } from "@/components/snackbar"
import { Bar, Button, IconButton, Text } from "@/components/ui"
import { ApiError, errorText } from "@/lib/api"
import { isOnline } from "@/lib/connectivity"
import { currentOf, uploadFile } from "@/lib/editor-save"
import { fetchToCache, offlineFolder } from "@/lib/file-cache"
import { useApi, useDetails, useMe } from "@/lib/files"
import { enqueue } from "@/lib/offline-queue"
import { CHANGED_BODY, CHANGED_TITLE, RED, cmdScript, colorFor, parseMsg, saveChoice, saveComplete, type Cmd, type EditorState, type Tool } from "@/lib/pdf-edit-rules"
import { previewSession } from "@/lib/preview-session"
import { toBase64 } from "@/lib/preview-rules"
import { cacheSignatures, cachedSignatures, keptBody } from "@/lib/signatures"
import { c } from "@/lib/theme"

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")
type Ask = "leave" | "changed" | null
type Saved = { file: File; size: number }

export default function PdfEdit() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const api = useApi()
  const snack = useSnack()
  const details = useDetails(id)
  const me = useMe()
  // The previewer's copy of the item, so a file opened offline can still be edited.
  const item = details.data?.item ?? previewSession()?.items.find((i) => i.id === id) ?? null
  const parentId = details.data?.details.parentId ?? null

  const [local, setLocal] = useState<File | null>(null)
  const [opened, setOpened] = useState<string | null | undefined>(undefined)
  const [failed, setFailed] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [st, setSt] = useState<EditorState | null>(null)
  const [color, setColor] = useState(RED)
  const [width, setWidth] = useState(3)
  const [busy, setBusy] = useState<"version" | "copy" | null>(null)
  const [ask, setAsk] = useState<Ask>(null)
  const [pending, setPending] = useState<Saved | null>(null)
  const [signing, setSigning] = useState(false)
  const [making, setMaking] = useState<SignatureKind | null>(null)
  const [kept, setKept] = useState<SignaturesResponse>(() => cachedSignatures(api.id))
  const web = useRef<WebView>(null)
  const started = useRef(false)
  const handle = useRef<ReturnType<File["open"]> | null>(null)
  const dirty = st?.dirty ?? false

  const send = useCallback((cmd: Cmd) => web.current?.injectJavaScript(cmdScript(cmd)), [])

  // Loads once the details are in (or at once with no connection): the cached copy, or the whole file.
  useEffect(() => {
    if (!item || started.current || (!details.data && isOnline())) return
    started.current = true
    ;(async () => {
      const url = async () => (await api.get<PreviewResponse>(`/items/${item.id}/preview`)).url
      try {
        const file = await fetchToCache(api.id, item.id, item.version, url)
        setOpened(details.data?.details.version ?? item.version)
        setLocal(file)
      } catch (e) {
        // Offline with an older kept copy (a newer version arrived after it was saved): edit that one. Its version is
        // the base, so Save asks (online) or the queued save goes to Couldn't sync, instead of overwriting the newer one.
        const dir = offlineFolder(api.id)
        const old = dir.exists ? dir.list().find((f): f is File => f instanceof File && f.name.startsWith(`${item.id}-`)) : undefined
        if (!old) throw e
        const v = old.name.slice(item.id.length + 1)
        setOpened(v === "current" ? null : v)
        setLocal(old)
      }
    })().catch((e) => setFailed(errorText(e)))
  }, [item, details.data, api])

  useEffect(
    () => () => {
      handle.current?.close()
      handle.current = null
    },
    []
  )

  // Your saved signature and initials, refreshed from the account and kept on the phone for placing offline.
  useEffect(() => {
    api.get<SignaturesResponse>("/signatures").then(
      (s) => {
        setKept(s)
        cacheSignatures(api.id, s)
      },
      () => {}
    )
  }, [api])

  // ---- The page ----

  const source = useMemo(() => {
    if (!local || !item) return null
    const meta = `<head><meta name="nimbus" content="${esc(JSON.stringify({ name: item.name, size: local.size, top: 0, bottom: 0, author: me.data?.name }))}">`
    return { html: (require("@/lib/viewers/pdf-edit").default as string).replace("<head>", () => meta), baseUrl: "about:blank" }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the page opens once per file
  }, [local, item?.name])

  // A save's pieces arrive as messages; they're written in order and the page says when the last one is sent.
  const incoming = useRef<{ id: number; file: File; chain: Promise<unknown>; got: number; ok: (s: Saved) => void; no: (e: Error) => void } | null>(null)
  const exportPdf = () =>
    new Promise<Saved>((ok, no) => {
      const file = new File(Paths.cache, `edit-${Date.now()}-${(item?.name ?? "file").replace(/[^\w.-]/g, "_")}`)
      file.create({ overwrite: true })
      incoming.current = { id: Date.now(), file, chain: Promise.resolve(), got: 0, ok, no }
      send({ c: "save", id: incoming.current.id })
    })

  const onMessage = (e: WebViewMessageEvent) => {
    const m = parseMsg(e.nativeEvent.data)
    if (!m || !local) return
    const inc = incoming.current
    switch (m.t) {
      case "read": {
        try {
          handle.current ??= local.open()
          handle.current.offset = m.offset
          const bytes = handle.current.readBytesSync(m.length)
          web.current?.injectJavaScript(`__reply(${m.id},"${toBase64(bytes)}");true;`)
        } catch {
          web.current?.injectJavaScript(`__reply(${m.id},null);true;`)
        }
        return
      }
      case "ready":
        return setReady(true)
      case "error":
        if (__DEV__) console.warn("pdf-edit:", m.detail)
        return setFailed(m.message ?? "Couldn't open this PDF for editing.")
      case "state":
        return setSt(m.s)
      case "part":
        if (inc?.id !== m.id) return
        inc.got++
        inc.chain = inc.chain.then(() => inc.file.write(m.b64, { encoding: "base64", append: true }))
        return
      case "saved":
        if (inc?.id !== m.id) return
        inc.chain.then(
          () => (saveComplete(m.parts, inc.got, m.size, inc.file.size ?? -1) ? inc.ok({ file: inc.file, size: m.size }) : inc.no(new Error("Couldn't save the PDF. Try again."))),
          (err) => inc.no(err)
        )
        return
      case "saveError":
        if (inc?.id === m.id) inc.no(new Error("Couldn't save the PDF. Try again."))
        return
    }
  }

  // ---- Saving ----

  // Leaves the file in a folder Android won't clear, for a save that has to wait for a connection.
  const keepForLater = async (saved: Saved) => {
    const dir = new Directory(Paths.document, "pdf-saves")
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true })
    const dest = new File(dir, saved.file.name)
    await saved.file.move(dest)
    return dest
  }

  const finish = async (saved: Saved, as: "version" | "copy", overwrite: boolean) => {
    if (!item) return
    setBusy(as)
    try {
      const queue = async () => {
        const dest = await keepForLater(saved)
        enqueue(api.id, { op: "savePdf", id: item.id, parentId, name: item.name, uri: dest.uri, size: saved.size, base: opened ?? item.version, as }, `Save “${item.name}”`)
        snack({ text: "Will sync when online." })
        router.back()
      }
      if (!isOnline()) return await queue()
      let now
      try {
        now = (await currentOf(api.account, item.id)).item
      } catch (e) {
        if (e instanceof ApiError && e.status === 0) return await queue()
        throw e
      }
      if (!now || now.trashedAt) throw new Error("This file is in the trash or gone, so it can't be saved.")
      if (saveChoice(as, overwrite, opened, now.version) === "ask") {
        setPending(saved)
        setAsk("changed")
        return
      }
      await uploadFile(api.account, parentId, now.name, saved.file.uri, saved.size, "application/pdf", as)
      snack({ text: as === "copy" ? "Saved as a copy." : "Saving a new version…" })
      router.back()
    } catch (e) {
      snack({ text: e instanceof Error && !(e instanceof ApiError) ? e.message : errorText(e), error: true })
    } finally {
      setBusy(null)
    }
  }

  const save = async (as: "version" | "copy") => {
    if (busy || !st) return
    setBusy(as)
    try {
      await finish(await exportPdf(), as, false)
    } catch (e) {
      setBusy(null)
      snack({ text: e instanceof Error ? e.message : "Couldn't save the PDF. Try again.", error: true })
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

  // ---- Toolbar ----

  const pick = (t: Tool) => {
    send({ c: "tool", v: t })
    const next = colorFor(t, color)
    if (next !== color) paint(next)
  }
  const paint = (hex: string) => {
    setColor(hex)
    send({ c: "color", v: hex })
  }
  const place = (kind: SignatureKind) => {
    const png = kept[kind]
    if (png) send({ c: "stamp", b64: png })
    else setMaking(kind)
  }
  const keep = async (kind: SignatureKind, png: string) => {
    try {
      await api.put("/signatures", { kind, png })
      const next = { ...kept, [kind]: png }
      setKept(next)
      cacheSignatures(api.id, next)
    } catch {
      snack({ text: "Couldn't save it to your account, but you can still place it.", error: true })
    }
  }

  // The page reports its tool back; colour and width are ours, so push them once it's open.
  useEffect(() => {
    if (!ready) return
    send({ c: "color", v: color })
    send({ c: "width", v: width })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the page opens
  }, [ready])

  const loading = !failed && !ready
  const name = item?.name ?? "PDF"
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Bar>
        <IconButton icon={X} label="Close editor" onPress={back} />
        <View style={{ flex: 1 }}>
          <Text variant="titleSmall" numberOfLines={1} accessibilityRole="header">{name}</Text>
          <Text variant="caption" color={c.mutedForeground}>{dirty ? "Unsaved changes" : "No changes"}</Text>
        </View>
        <IconButton icon={ArrowUUpLeft} label="Undo" onPress={() => send({ c: "undo" })} color={st?.canUndo ? c.foreground : c.mutedForeground} />
        <IconButton icon={ArrowUUpRight} label="Redo" onPress={() => send({ c: "redo" })} color={st?.canRedo ? c.foreground : c.mutedForeground} />
        <IconButton icon={CopySimple} label="Save as copy" onPress={() => save("copy")} color={st && !busy ? c.foreground : c.mutedForeground} />
        <View style={{ marginRight: 8 }}>
          <Button label="Save" onPress={() => save("version")} busy={busy === "version"} disabled={!st || !dirty || !!busy} />
        </View>
      </Bar>

      {failed ? (
        <View style={{ padding: 24, gap: 12 }}>
          <Text color={c.destructive}>{failed}</Text>
          <Button variant="outlined" label="Back" onPress={() => router.back()} />
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          {source && (
            <WebView
              ref={web as never}
              source={source}
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
              style={{ flex: 1, backgroundColor: "#6b7280" }}
            />
          )}
          {loading && (
            <View pointerEvents="none" style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center", backgroundColor: c.background }}>
              <ActivityIndicator color={c.mutedForeground} accessibilityLabel="Opening" />
            </View>
          )}
        </View>
      )}

      {!failed && <PdfEditToolbar state={ready ? st : null} color={color} width={width} onTool={pick} onColor={paint} onWidth={(w) => (setWidth(w), send({ c: "width", v: w }))} onSign={() => setSigning(true)} onDelete={() => send({ c: "delete" })} />}

      {signing && (
        <Sheet onClose={() => setSigning(false)} header={<Text variant="titleSmall" style={{ paddingHorizontal: 20, paddingBottom: 8 }}>Sign</Text>}>
          <SheetRow icon={<Signature size={24} color={c.foreground} />} label={kept.signature ? "Place my signature" : "Add my signature…"} onPress={() => place("signature")} />
          <SheetRow icon={<Signature size={24} color={c.foreground} />} label={kept.initials ? "Place my initials" : "Add my initials…"} onPress={() => place("initials")} />
          {kept.signature && <SheetRow label="Change my signature…" onPress={() => setMaking("signature")} />}
          {kept.initials && <SheetRow label="Change my initials…" onPress={() => setMaking("initials")} />}
        </Sheet>
      )}
      {making && (
        <SignatureSheet
          kind={making}
          onClose={() => setMaking(null)}
          onDone={(png, keepIt) => {
            const kind = making
            setMaking(null)
            if (keepIt) void keep(kind, png)
            send({ c: "stamp", b64: png })
          }}
        />
      )}

      {ask === "leave" && (
        <Frame title="Discard your changes?" onClose={() => setAsk(null)}>
          <Text color={c.mutedForeground}>Your marks on “{item?.name}” haven't been saved.</Text>
          <Actions>
            <Button variant="text" label="Keep editing" onPress={() => setAsk(null)} />
            <Button variant="text" danger label="Discard" onPress={() => router.back()} />
          </Actions>
        </Frame>
      )}
      {ask === "changed" && pending && (
        <Frame title={CHANGED_TITLE} onClose={() => setAsk(null)}>
          <Text color={c.mutedForeground}>{CHANGED_BODY}</Text>
          <Actions>
            <Button variant="text" label="Cancel" onPress={() => setAsk(null)} />
            <Button
              variant="outlined"
              label="Save as copy"
              onPress={() => {
                setAsk(null)
                void finish(pending, "copy", false)
              }}
            />
            <Button
              label="Overwrite"
              onPress={() => {
                setAsk(null)
                void finish(pending, "version", true)
              }}
            />
          </Actions>
        </Frame>
      )}
    </View>
  )
}
