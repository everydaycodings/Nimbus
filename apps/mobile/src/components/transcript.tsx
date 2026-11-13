import type { Item, Role } from "@nimbus/shared/api"
import { useQueryClient } from "@tanstack/react-query"
import { Directory, File, Paths } from "expo-file-system"
import * as Sharing from "expo-sharing"
import { CaretDown, CaretUp, DownloadSimple } from "phosphor-react-native"
import { useState } from "react"
import { ActivityIndicator, Pressable, View } from "react-native"

import { useDismiss } from "@/components/sheet"
import { useSnack } from "@/components/snackbar"
import { Button, Text } from "@/components/ui"
import { anchorTarget } from "@/lib/comment-anchor"
import { errorText, send } from "@/lib/api"
import { useApi } from "@/lib/files"
import { useAi, useTranscript } from "@/lib/people"
import { openPreview } from "@/lib/preview-session"
import { c, radius } from "@/lib/theme"
import { clock } from "@/lib/time"
import { langName } from "@/lib/transcript-rules"

const PREVIEW_LINES = 5

// Details' "Transcript": what Nimbus heard in a video or audio file. A line jumps there; the owner can have it redone.
export function Transcript({ item, role }: { item: Item; role: Role }) {
  const api = useApi()
  const ai = useAi()
  const client = useQueryClient()
  const snack = useSnack()
  const dismiss = useDismiss()
  const q = useTranscript(item.id, ai.speech)
  const [all, setAll] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const t = q.data
  if (!ai.speech || !t || t.state === "off" || t.state === "none") return null

  const again = async () => {
    setBusy("redo")
    try {
      await api.post(`/files/${item.id}/transcript`)
      snack({ text: "It will be transcribed again shortly." })
      await client.invalidateQueries({ queryKey: [api.id, "transcript", item.id] })
    } catch (e) {
      snack({ text: errorText(e), error: true })
    }
    setBusy(null)
  }

  // The text comes with the sign-in header, so it is fetched here and handed to Android's share sheet.
  const download = async (format: "srt" | "txt") => {
    setBusy(format)
    try {
      const r = await send(api.account.server, `/api/v1/files/${item.id}/transcript?format=${format}`, { token: api.account.token })
      if (!r.ok) throw new Error(r.status === 404 ? "There is no transcript to download yet." : "Couldn't download the transcript.")
      const dir = new Directory(Paths.cache, "transcripts")
      if (!dir.exists) dir.create({ intermediates: true, idempotent: true })
      const base = item.name.replace(/\.[^.]+$/, "") || "transcript"
      const file = new File(dir, `${base}.${format}`)
      if (file.exists) file.delete()
      file.create()
      file.write(await r.text())
      if (!(await Sharing.isAvailableAsync())) throw new Error("This phone can't share files from here.")
      await Sharing.shareAsync(file.uri, { mimeType: format === "srt" ? "application/x-subrip" : "text/plain", dialogTitle: file.name })
    } catch (e) {
      snack({ text: errorText(e), error: true })
    }
    setBusy(null)
  }

  const go = (tMs: number) => {
    const target = anchorTarget(item.id)
    dismiss(() => {
      if (target?.seek) target.seek(tMs / 1000)
      else openPreview({ items: [item], index: 0, role, start: { tMs } })
    })
  }

  const line =
    t.state === "waiting" ? "Waiting to be transcribed" : t.state === "failed" ? `Couldn't transcribe it${t.failed ? `: ${t.failed}` : ""}` : langName(t.lang) ? `Spoken language: ${langName(t.lang)}` : "Transcribed by Nimbus"
  const shown = all ? t.lines : t.lines.slice(0, PREVIEW_LINES)
  const hidden = t.lines.length - shown.length

  return (
    <View style={{ paddingHorizontal: 20, paddingVertical: 8, gap: 8 }}>
      <Text variant="caption" color={c.mutedForeground}>Transcript</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {t.state === "waiting" && <ActivityIndicator size="small" color={c.mutedForeground} />}
        <Text color={t.state === "failed" ? c.destructive : undefined} style={{ flex: 1 }}>{line}</Text>
      </View>
      {t.state === "done" && (
        <>
          <View style={{ borderRadius: radius.card, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, paddingHorizontal: 4 }}>
            {shown.map((l, i) => (
              <Pressable
                key={`${l.tMs}-${i}`}
                onPress={() => go(l.tMs)}
                android_ripple={{ color: c.ripple }}
                accessibilityRole="button"
                accessibilityLabel={`${clock(l.tMs / 1000)}: ${l.text}. Play from here`}
                style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 8, paddingVertical: 8 }}
              >
                <Text variant="caption" color={c.brand} style={{ minWidth: 40, fontVariant: ["tabular-nums"] }}>{clock(l.tMs / 1000)}</Text>
                <Text variant="bodySmall" style={{ flex: 1 }}>{l.text}</Text>
              </Pressable>
            ))}
          </View>
          {(hidden > 0 || all) && t.lines.length > PREVIEW_LINES && (
            <Pressable
              onPress={() => setAll((a) => !a)}
              android_ripple={{ color: c.ripple }}
              accessibilityRole="button"
              accessibilityState={{ expanded: all }}
              style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 6 }}
            >
              {all ? <CaretUp size={16} color={c.brand} /> : <CaretDown size={16} color={c.brand} />}
              <Text variant="label" color={c.brand}>{all ? "Show less" : `Show all ${t.lines.length} lines`}</Text>
            </Pressable>
          )}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <Button variant="outlined" label="Download .srt" busy={busy === "srt"} icon={<DownloadSimple size={18} color={c.foreground} />} onPress={() => download("srt")} />
            <Button variant="outlined" label="Download .txt" busy={busy === "txt"} icon={<DownloadSimple size={18} color={c.foreground} />} onPress={() => download("txt")} />
          </View>
        </>
      )}
      {t.canRedo && (
        <View style={{ alignSelf: "flex-start" }}>
          <Button variant="outlined" label="Transcribe again" busy={busy === "redo"} onPress={again} />
        </View>
      )}
    </View>
  )
}
