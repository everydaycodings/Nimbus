import { DateTimePickerAndroid } from "@react-native-community/datetimepicker"
import { useQueryClient } from "@tanstack/react-query"
import { router } from "expo-router"
import { Bell, Clock, EyeSlash, UsersThree } from "phosphor-react-native"
import { useState } from "react"
import { View } from "react-native"

import { Caret, Row, SwitchRow } from "@/components/page"
import { Sheet } from "@/components/sheet"
import { useSnack } from "@/components/snackbar"
import { Text } from "@/components/ui"
import { errorText } from "@/lib/api"
import { useApi } from "@/lib/files"
import { noticeAvailable, noticeState, setNotice, timeLabel } from "@/lib/memories-notice"
import { usePartner } from "@/lib/photos"
import { allowNotifications } from "@/lib/push"
import { c } from "@/lib/theme"

const icon = (I: typeof Bell) => <I size={24} color={c.mutedForeground} />

// Photos settings: the partner toggle, the daily notice, hidden memories and partner sharing.
export function PhotoSettings({ onClose }: { onClose: () => void }) {
  const api = useApi()
  const client = useQueryClient()
  const snack = useSnack()
  const partner = usePartner()
  const [notice, setLocal] = useState(noticeState)
  const active = (partner.data?.incoming ?? []).filter((p) => p.status === "active")
  const shown = active.length > 0 && !active.every((p) => p.hidden)

  const togglePartner = async (on: boolean) => {
    try {
      await Promise.all(active.map((p) => api.patch("/partner", { userId: p.person.id, hidden: !on })))
      await Promise.all([client.invalidateQueries({ queryKey: [api.id, "partner"] }), client.invalidateQueries({ queryKey: [api.id, "photos"] })])
    } catch (e) {
      snack({ text: errorText(e), error: true })
    }
  }
  const change = async (next: typeof notice) => {
    if (next.enabled && !(await allowNotifications())) return snack({ text: "Allow notifications for Nimbus to get this notice.", error: true })
    setLocal(next)
    setNotice(next)
  }
  const pickTime = () =>
    DateTimePickerAndroid.open({
      mode: "time",
      value: new Date(2000, 0, 1, notice.hour, notice.minute),
      onValueChange: (_, d) => d && change({ ...notice, hour: d.getHours(), minute: d.getMinutes() }),
    })

  return (
    <Sheet onClose={onClose} header={<Text variant="titleSmall" style={{ paddingHorizontal: 20, paddingBottom: 8 }}>Photo settings</Text>}>
      <View>
        {active.length > 0 && (
          <SwitchRow
            label="Show partner photos"
            detail={`In your timeline, from ${active.map((p) => p.person.name).join(", ")}`}
            icon={icon(UsersThree)}
            value={shown}
            onChange={togglePartner}
          />
        )}
        {noticeAvailable && (
          <>
            <SwitchRow
              label="Daily On this day notice"
              detail="Only on days that have memories"
              icon={icon(Bell)}
              value={notice.enabled}
              onChange={(enabled) => change({ ...notice, enabled })}
            />
            {notice.enabled && <Row label="Notice time" detail={timeLabel(notice.hour, notice.minute)} icon={icon(Clock)} trailing={<Caret />} onPress={pickTime} />}
          </>
        )}
        <Row
          label="Hidden from memories"
          icon={icon(EyeSlash)}
          trailing={<Caret />}
          onPress={() => {
            onClose()
            router.push("/memories/hidden")
          }}
        />
        <Row
          label="Partner sharing"
          detail="Share your photos with one person"
          icon={icon(UsersThree)}
          trailing={<Caret />}
          onPress={() => {
            onClose()
            router.push("/account/partner")
          }}
        />
      </View>
    </Sheet>
  )
}
