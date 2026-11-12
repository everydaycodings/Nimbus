import type { SmartGroup } from "@nimbus/shared/api"
import { router } from "expo-router"
import { DeviceMobile, FileText, FilmStrip, MapPin, Receipt, SquaresFour, type Icon } from "phosphor-react-native"
import { Pressable, ScrollView, View } from "react-native"

import { Text } from "@/components/ui"
import { useInstance } from "@/lib/files"
import { mapsAvailable } from "@/lib/maps"
import { c, radius } from "@/lib/theme"

export const SMART_LABEL: Record<SmartGroup, string> = { screenshots: "Screenshots", documents: "Documents", receipts: "Receipts", videos: "Videos" }
const SMART_ICON: Record<SmartGroup, Icon> = { screenshots: DeviceMobile, documents: FileText, receipts: Receipt, videos: FilmStrip }

function Chip({ label, icon: I, onPress }: { label: string; icon: Icon; onPress: () => void }) {
  return (
    <View style={{ minHeight: 48, justifyContent: "center" }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        android_ripple={{ color: c.ripple, borderless: false }}
        hitSlop={{ top: 6, bottom: 6 }}
        onPress={onPress}
        style={{ height: 36, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: c.input }}
      >
        <I size={18} color={c.mutedForeground} />
        <Text variant="label">{label}</Text>
      </Pressable>
    </View>
  )
}

// Albums, Places and the smart groups. Places needs the native map and the admin's say-so.
export function PhotoChips() {
  const instance = useInstance()
  const places = mapsAvailable && instance.data?.map?.enabled === true
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, gap: 8 }} style={{ flexGrow: 0 }}>
      <Chip label="Albums" icon={SquaresFour} onPress={() => router.push("/albums")} />
      {places && <Chip label="Places" icon={MapPin} onPress={() => router.push("/places")} />}
      {(Object.keys(SMART_LABEL) as SmartGroup[]).map((g) => (
        <Chip key={g} label={SMART_LABEL[g]} icon={SMART_ICON[g]} onPress={() => router.push({ pathname: "/smart/[group]", params: { group: g } })} />
      ))}
    </ScrollView>
  )
}
