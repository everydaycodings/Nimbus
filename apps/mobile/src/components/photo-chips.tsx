import type { SmartGroup } from "@nimbus/shared/api"
import { router } from "expo-router"
import { DeviceMobile, FileText, FilmStrip, MapPin, Receipt, SquaresFour, UsersThree, type Icon } from "phosphor-react-native"
import type { ReactNode } from "react"
import { Pressable, ScrollView, View } from "react-native"

import { PersonFace } from "@/components/people-ui"
import { Text } from "@/components/ui"
import { useInstance } from "@/lib/files"
import { mapsAvailable } from "@/lib/maps"
import { useAi, usePeople } from "@/lib/people"
import { c, radius } from "@/lib/theme"

export const SMART_LABEL: Record<SmartGroup, string> = { screenshots: "Screenshots", documents: "Documents", receipts: "Receipts", videos: "Videos" }
const SMART_ICON: Record<SmartGroup, Icon> = { screenshots: DeviceMobile, documents: FileText, receipts: Receipt, videos: FilmStrip }

function Chip({ label, icon: I, leading, onPress }: { label: string; icon?: Icon; leading?: ReactNode; onPress: () => void }) {
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
        {leading ?? (I && <I size={18} color={c.mutedForeground} />)}
        <Text variant="label">{label}</Text>
      </Pressable>
    </View>
  )
}

// Albums, People, Places and the smart groups. Places needs the native map and the admin's say-so; People the admin's face grouping switch.
export function PhotoChips() {
  const instance = useInstance()
  const places = mapsAvailable && instance.data?.map?.enabled === true
  const ai = useAi()
  const people = usePeople(false, ai.faces && ai.facesOn)
  const named = (people.data?.people ?? []).filter((p) => p.name).slice(0, 5)
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, gap: 8 }} style={{ flexGrow: 0 }}>
      <Chip label="Albums" icon={SquaresFour} onPress={() => router.push("/albums")} />
      {ai.faces && <Chip label="People" icon={UsersThree} onPress={() => router.push("/people")} />}
      {named.map((p) => (
        <Chip key={p.id} label={p.name!} leading={<PersonFace person={p} size={22} />} onPress={() => router.push({ pathname: "/people/[id]", params: { id: p.id, name: p.name! } })} />
      ))}
      {places && <Chip label="Places" icon={MapPin} onPress={() => router.push("/places")} />}
      {(Object.keys(SMART_LABEL) as SmartGroup[]).map((g) => (
        <Chip key={g} label={SMART_LABEL[g]} icon={SMART_ICON[g]} onPress={() => router.push({ pathname: "/smart/[group]", params: { group: g } })} />
      ))}
    </ScrollView>
  )
}
