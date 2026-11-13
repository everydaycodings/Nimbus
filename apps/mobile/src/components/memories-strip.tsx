import type { MemoryYear, PersonMemory } from "@nimbus/shared/api"
import { Image } from "expo-image"
import { router } from "expo-router"
import { EyeSlash, UserMinus } from "phosphor-react-native"
import { useState } from "react"
import { Pressable, ScrollView, View } from "react-native"

import { Sheet, SheetRow } from "@/components/sheet"
import { useSnack } from "@/components/snackbar"
import { Text } from "@/components/ui"
import { errorText } from "@/lib/api"
import { useApi } from "@/lib/files"
import { yearsAgo } from "@/lib/memory-slides"
import { usePeopleRefresh } from "@/lib/people"
import { thumbSource, useHideMemory } from "@/lib/photos"
import { c, radius } from "@/lib/theme"

export const STRIP_H = 188
const W = 120
const H = 150

// On this day: one card per past year. A tap plays that year's slideshow, a long press offers to hide the day.
export function MemoriesStrip({ date, years, people = [] }: { date: string; years: MemoryYear[]; people?: PersonMemory[] }) {
  const api = useApi()
  const { account } = api
  const hide = useHideMemory()
  const snack = useSnack()
  const refresh = usePeopleRefresh()
  const [menu, setMenu] = useState(false)
  const [personMenu, setPersonMenu] = useState<PersonMemory | null>(null)
  // "No memories of X": off on the person, back on from their People page (or Undo).
  const personMemories = async (m: PersonMemory, on: boolean) => {
    try {
      await api.patch(`/people/${m.personId}`, { memories: on })
      await refresh()
      if (!on) snack({ text: `No more memories of ${m.name}.`, undo: () => void personMemories(m, true) })
    } catch (e) {
      snack({ text: errorText(e), error: true })
    }
  }
  return (
    <View style={{ height: STRIP_H, justifyContent: "center" }}>
      <Text variant="titleSmall" accessibilityRole="header" style={{ paddingHorizontal: 16, paddingBottom: 8 }}>{people.length ? "Memories" : "On this day"}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
        {years.map((y) => {
          const cover = y.items.find((p) => p.thumb)
          return (
            <Pressable
              key={y.year}
              accessibilityRole="button"
              accessibilityLabel={`${yearsAgo(y.yearsAgo)}, ${y.items.length} ${y.items.length === 1 ? "photo" : "photos"}. Play. Long press for more`}
              android_ripple={{ color: c.ripple }}
              onPress={() => router.push({ pathname: "/slideshow", params: { memories: date, year: String(y.year) } })}
              onLongPress={() => setMenu(true)}
              style={{ width: W, height: H, borderRadius: radius.card, overflow: "hidden", backgroundColor: c.card }}
            >
              {cover && <Image source={thumbSource(account, cover)} style={{ width: W, height: H }} contentFit="cover" cachePolicy="memory-disk" accessibilityIgnoresInvertColors />}
              <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: "rgba(0,0,0,0.6)" }}>
                <Text variant="label" color="#fff" numberOfLines={1}>{yearsAgo(y.yearsAgo)}</Text>
                <Text variant="caption" color="rgba(255,255,255,0.75)" style={{ fontVariant: ["tabular-nums"] }}>{y.year}</Text>
              </View>
            </Pressable>
          )
        })}
        {people.map((m) => {
          const cover = m.items.find((p) => p.thumb)
          return (
            <Pressable
              key={`${m.personId}-${m.year}`}
              accessibilityRole="button"
              accessibilityLabel={`With ${m.name}, ${m.year}, ${m.items.length} ${m.items.length === 1 ? "photo" : "photos"}. Play. Long press for more`}
              android_ripple={{ color: c.ripple }}
              onPress={() => router.push({ pathname: "/slideshow", params: { memories: date, person: m.personId, year: String(m.year) } })}
              onLongPress={() => setPersonMenu(m)}
              style={{ width: W, height: H, borderRadius: radius.card, overflow: "hidden", backgroundColor: c.card }}
            >
              {cover && <Image source={thumbSource(account, cover)} style={{ width: W, height: H }} contentFit="cover" cachePolicy="memory-disk" accessibilityIgnoresInvertColors />}
              <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: "rgba(0,0,0,0.6)" }}>
                <Text variant="label" color="#fff" numberOfLines={1}>With {m.name}</Text>
                <Text variant="caption" color="rgba(255,255,255,0.75)" style={{ fontVariant: ["tabular-nums"] }}>{m.year}</Text>
              </View>
            </Pressable>
          )
        })}
      </ScrollView>
      {menu && (
        <Sheet onClose={() => setMenu(false)} header={<Text variant="titleSmall" style={{ paddingHorizontal: 20, paddingBottom: 8 }}>On this day</Text>}>
          <SheetRow label="Hide this day from memories" icon={<EyeSlash size={24} color={c.mutedForeground} />} onPress={() => hide({ kind: "day", day: date.slice(5) }, "This day is hidden from memories.")} />
        </Sheet>
      )}
      {personMenu && (
        <Sheet onClose={() => setPersonMenu(null)} header={<Text variant="titleSmall" numberOfLines={1} style={{ paddingHorizontal: 20, paddingBottom: 8 }}>With {personMenu.name}</Text>}>
          <SheetRow
            label={`No memories of ${personMenu.name}`}
            detail="Turn them back on from their People page"
            icon={<UserMinus size={24} color={c.mutedForeground} />}
            onPress={() => void personMemories(personMenu, false)}
          />
        </Sheet>
      )}
    </View>
  )
}
