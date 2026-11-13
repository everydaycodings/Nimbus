import type { Item } from "@nimbus/shared/api"
import { useQueryClient } from "@tanstack/react-query"
import * as Clipboard from "expo-clipboard"
import { CaretDown, CaretUp, Copy } from "phosphor-react-native"
import { useState } from "react"
import { ActivityIndicator, Pressable, View } from "react-native"

import { useSnack } from "@/components/snackbar"
import { Button, Text } from "@/components/ui"
import { errorText } from "@/lib/api"
import { useApi, useTextStatus } from "@/lib/files"
import { c } from "@/lib/theme"

// Details' "Text found": what the server read out of an image, PDF or video, for search.
export function TextFound({ item }: { item: Item }) {
  const api = useApi()
  const client = useQueryClient()
  const snack = useSnack()
  const q = useTextStatus(item.id, true)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const s = q.data
  if (!s || s.state === "none") return null

  const line =
    s.state === "done"
      ? s.preview
        ? `Read ${s.readAt ? new Date(s.readAt).toLocaleDateString(undefined, { dateStyle: "medium" }) : "by Nimbus"}`
        : "No text found"
      : s.state === "waiting"
        ? "Waiting to be read"
        : s.state === "failed"
          ? `Couldn't read it${s.failed ? `: ${s.failed}` : ""}`
          : "Reading text is turned off"

  const again = async () => {
    setBusy(true)
    try {
      await api.post(`/files/${item.id}/reread`)
      snack({ text: "It will be read again shortly." })
      client.invalidateQueries({ queryKey: [api.id, "text", item.id] })
    } catch (e) {
      snack({ text: errorText(e), error: true })
    }
    setBusy(false)
  }

  return (
    <View style={{ paddingHorizontal: 20, paddingVertical: 8, gap: 8 }}>
      <Text variant="caption" color={c.mutedForeground}>
        Text found
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {s.state === "waiting" && <ActivityIndicator size="small" color={c.mutedForeground} />}
        <Text color={s.state === "failed" ? c.destructive : undefined} style={{ flex: 1 }}>
          {line}
        </Text>
      </View>
      {!!s.preview && (
        <>
          <Pressable
            onPress={() => setOpen((o) => !o)}
            android_ripple={{ color: c.ripple }}
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            accessibilityLabel={open ? "Hide the text" : "Show the text"}
            style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 6 }}
          >
            {open ? <CaretUp size={16} color={c.brand} /> : <CaretDown size={16} color={c.brand} />}
            <Text variant="label" color={c.brand}>
              {open ? "Hide text" : "Show text"}
            </Text>
          </Pressable>
          {open && (
            <>
              <View style={{ padding: 12, borderRadius: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.border }}>
                <Text variant="bodySmall" selectable>
                  {s.preview}
                </Text>
              </View>
              <View style={{ alignSelf: "flex-start" }}>
                <Button
                  variant="outlined"
                  label="Copy"
                  icon={<Copy size={18} color={c.foreground} />}
                  onPress={() => void Clipboard.setStringAsync(s.preview).then(() => snack({ text: "Text copied." }))}
                />
              </View>
            </>
          )}
        </>
      )}
      {s.canReread && (
        <View style={{ alignSelf: "flex-start" }}>
          <Button variant="outlined" label="Read text again" busy={busy} onPress={again} />
        </View>
      )}
    </View>
  )
}
