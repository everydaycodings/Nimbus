// Make a signature or initials: draw, type or a picture. The canvas work happens in a small WebView (viewer/signature.ts);
// the controls are native. Returns the transparent PNG as base64, and whether to keep it on the account.
import * as ImagePicker from "expo-image-picker"
import { Check } from "phosphor-react-native"
import { useCallback, useMemo, useRef, useState } from "react"
import { Pressable, TextInput, useWindowDimensions, View } from "react-native"
import { WebView, type WebViewMessageEvent } from "react-native-webview"

import { SwitchRow } from "@/components/page"
import { Sheet, useDismiss } from "@/components/sheet"
import { Button, ErrorText, Text } from "@/components/ui"
import { HANDWRITING, INKS, SIGNATURE_MAX_BYTES, padScript, type PadCmd } from "@/lib/pdf-edit-rules"
import { whilePicking } from "@/lib/picking"
import { c, radius, type as t } from "@/lib/theme"

type Tab = "draw" | "type" | "upload"
const TABS: { id: Tab; label: string }[] = [
  { id: "draw", label: "Draw" },
  { id: "type", label: "Type" },
  { id: "upload", label: "Upload" },
]
const html = () =>
  (require("@/lib/viewers/signature").default as string).replace("<head>", () => `<head><meta name="nimbus" content="${JSON.stringify({ name: "signature", size: 0, top: 0, bottom: 0 }).replace(/"/g, "&quot;")}">`)

export function SignatureSheet({
  kind,
  onDone,
  onClose,
}: {
  kind: "signature" | "initials"
  onDone: (png: string, keep: boolean) => void
  onClose: () => void
}) {
  const { width } = useWindowDimensions()
  const padW = Math.min(width, 640) - 32
  const web = useRef<WebView>(null)
  const source = useMemo(() => ({ html: html(), baseUrl: "about:blank" }), [])
  const [tab, setTab] = useState<Tab>("draw")
  const [ink, setInk] = useState(INKS[0].hex)
  const [font, setFont] = useState(HANDWRITING[0])
  const [text, setText] = useState("")
  const [has, setHas] = useState(false)
  const [keep, setKeep] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const waiting = useRef<{ id: number; ok: (b64: string | null) => void } | null>(null)
  const word = kind === "signature" ? "signature" : "initials"

  const send = useCallback((cmd: PadCmd) => web.current?.injectJavaScript(padScript(cmd)), [])
  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const m = JSON.parse(e.nativeEvent.data)
      if (m.t === "has") setHas(!!m.on)
      else if (m.t === "png") waiting.current?.ok(m.b64)
      else if (m.t === "imageError") setError("Couldn't read that picture. Try a PNG or JPEG.")
    } catch {}
  }

  const choose = (next: Tab) => {
    setTab(next)
    setError(null)
    send({ c: "mode", v: next })
  }
  const pick = async () => {
    setError(null)
    const r = await whilePicking(() => ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], base64: true, quality: 0.8 }))
    const b64 = r.assets?.[0]?.base64
    if (!r.canceled && b64) send({ c: "image", b64 })
  }

  const use = async (dismiss: (after?: () => void) => void) => {
    setBusy(true)
    setError(null)
    const png = await new Promise<string | null>((ok) => {
      waiting.current = { id: 1, ok }
      send({ c: "export", id: 1 })
      setTimeout(() => ok(null), 8000)
    })
    setBusy(false)
    if (!png) return setError(`Add your ${word} first.`)
    if (png.length * 0.75 > SIGNATURE_MAX_BYTES) return setError(`That ${word} is too detailed. Try a simpler one.`)
    dismiss(() => onDone(png, keep))
  }

  return (
    <Sheet
      onClose={onClose}
      header={
        <View style={{ paddingHorizontal: 20, paddingBottom: 8, gap: 2 }}>
          <Text variant="titleSmall">{kind === "signature" ? "Your signature" : "Your initials"}</Text>
          <Text variant="bodySmall" color={c.mutedForeground}>Draw it, type it or upload a picture. You can move and resize it on the page.</Text>
        </View>
      }
      footer={<Footer busy={busy} disabled={!has} onUse={use} onClear={tab === "draw" && has ? () => send({ c: "clear" }) : undefined} />}
    >
      <View style={{ paddingHorizontal: 16, gap: 12, paddingBottom: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }} accessibilityRole="tablist">
          {TABS.map((x) => (
            <Pressable
              key={x.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === x.id }}
              onPress={() => choose(x.id)}
              android_ripple={{ color: c.ripple }}
              style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: radius.control, justifyContent: "center", backgroundColor: tab === x.id ? c.mutedStrong : "transparent" }}
            >
              <Text variant="label" color={tab === x.id ? c.foreground : c.mutedForeground}>{x.label}</Text>
            </Pressable>
          ))}
          {tab !== "upload" && (
            <View style={{ flexDirection: "row", marginLeft: "auto" }} accessibilityRole="radiogroup">
              {INKS.map((i) => (
                <Pressable
                  key={i.hex}
                  accessibilityRole="radio"
                  accessibilityLabel={i.label}
                  accessibilityState={{ checked: ink === i.hex }}
                  onPress={() => {
                    setInk(i.hex)
                    send({ c: "ink", v: i.hex })
                  }}
                  style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}
                >
                  <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: i.hex, borderWidth: ink === i.hex ? 2 : 1, borderColor: ink === i.hex ? c.brand : c.input, alignItems: "center", justifyContent: "center" }}>
                    {ink === i.hex && <Check size={14} color="#fff" weight="bold" />}
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {tab === "type" && (
          <View style={{ gap: 8 }}>
            <TextInput
              value={text}
              onChangeText={(v) => {
                setText(v)
                send({ c: "text", v })
              }}
              maxLength={40}
              autoCorrect={false}
              placeholder={kind === "signature" ? "Type your name" : "Type your initials"}
              accessibilityLabel={kind === "signature" ? "Your name" : "Your initials"}
              placeholderTextColor={c.mutedForeground}
              selectionColor={c.brand}
              cursorColor={c.brand}
              style={[t.body, { minHeight: 48, color: c.foreground, borderWidth: 1, borderColor: c.input, borderRadius: radius.control, paddingHorizontal: 12 }]}
            />
            <View style={{ flexDirection: "row", gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="Handwriting style">
              {HANDWRITING.map((f) => (
                <Pressable
                  key={f}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: font === f }}
                  onPress={() => {
                    setFont(f)
                    send({ c: "font", v: f })
                  }}
                  android_ripple={{ color: c.ripple }}
                  style={{ flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.control, borderWidth: 1, borderColor: font === f ? c.brand : c.input, backgroundColor: font === f ? c.brandWash : "transparent" }}
                >
                  <Text variant="label" color={font === f ? c.foreground : c.mutedForeground} numberOfLines={1}>{f}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        <View style={{ width: padW, height: (padW * 400) / 1120, borderRadius: radius.control, overflow: "hidden", backgroundColor: "#fff" }}>
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
            scrollEnabled={false}
            nestedScrollEnabled
            textZoom={100}
            accessibilityLabel={`Draw your ${word} here`}
            style={{ backgroundColor: "#fff" }}
          />
          {tab === "draw" && !has && (
            <View pointerEvents="none" style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" }}>
              <Text variant="bodySmall" color="#a3a3a3">Sign here with your finger or a pen</Text>
            </View>
          )}
          {tab === "upload" && !has && (
            <View pointerEvents="none" style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center", padding: 16 }}>
              <Text variant="bodySmall" color="#737373" style={{ textAlign: "center" }}>A photo of your {word} on white paper works best. The white is removed.</Text>
            </View>
          )}
        </View>

        {tab === "upload" && <Button variant="outlined" label={has ? "Choose another picture" : "Choose a picture"} onPress={pick} />}
        <View style={{ marginHorizontal: -16 }}>
          <SwitchRow label="Keep it for next time" detail="On your account, for the web and the app" value={keep} onChange={setKeep} />
        </View>
        {error && <ErrorText>{error}</ErrorText>}
      </View>
    </Sheet>
  )
}

// Inside the sheet's context so Use can slide it away before handing the picture over.
function Footer({ busy, disabled, onUse, onClear }: { busy: boolean; disabled: boolean; onUse: (d: (after?: () => void) => void) => void; onClear?: () => void }) {
  const dismiss = useDismiss()
  return (
    <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, paddingHorizontal: 16, paddingTop: 8 }}>
      {onClear && <View style={{ marginRight: "auto" }}><Button variant="text" label="Clear" onPress={onClear} /></View>}
      <Button variant="text" label="Cancel" onPress={() => dismiss()} />
      <Button label="Use" onPress={() => onUse(dismiss)} busy={busy} disabled={disabled} />
    </View>
  )
}
