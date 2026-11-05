import type { TypeKey } from "@nimbus/shared/file-rules"
import { router } from "expo-router"
import { ArrowLeft, ClockCounterClockwise, MagnifyingGlass, X } from "phosphor-react-native"
import { useEffect, useState } from "react"
import { Pressable, TextInput, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Browser } from "@/components/browser"
import { FILE_TYPES } from "@/components/file-icon"
import { Text } from "@/components/ui"
import { useApi, type Filters } from "@/lib/files"
import { usePrefs } from "@/lib/prefs"
import { c, radius, type } from "@/lib/theme"

const KEEP = 10
const TRY: TypeKey[] = ["pdf", "image", "video", "doc"]

export default function Search() {
  const inset = useSafeAreaInsets()
  const { id } = useApi()
  const [prefs, setPrefs] = usePrefs(id)
  const recents = prefs.recentSearches ?? []
  const [text, setText] = useState("")
  const [q, setQ] = useState("")

  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250)
    return () => clearTimeout(t)
  }, [text])

  const remember = (term: string) => {
    if (term) setPrefs({ recentSearches: [term, ...recents.filter((r) => r !== term)].slice(0, KEEP) })
  }
  const search = (term: string) => {
    setText(term)
    setQ(term)
    remember(term)
  }

  const top = (
    <View style={{ paddingTop: inset.top + 8, paddingHorizontal: 4, flexDirection: "row", alignItems: "center", gap: 4 }}>
      <View style={{ borderRadius: 24, overflow: "hidden" }}>
        <Pressable
          onPress={() => router.back()}
          android_ripple={{ color: c.ripple }}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}
        >
          <ArrowLeft size={24} color={c.foreground} />
        </Pressable>
      </View>
      <View
        style={{
          flex: 1,
          minHeight: 56,
          marginRight: 12,
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: 16,
          gap: 12,
          borderRadius: radius.pill,
          backgroundColor: c.card,
          borderWidth: 1,
          borderColor: c.border,
        }}
      >
        <MagnifyingGlass size={22} color={c.mutedForeground} />
        <TextInput
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => search(text.trim())}
          autoFocus
          autoCorrect={false}
          returnKeyType="search"
          placeholder="Search in Nimbus"
          placeholderTextColor={c.mutedForeground}
          selectionColor={c.brand}
          cursorColor={c.brand}
          accessibilityLabel="Search in Nimbus"
          style={[type.body, { flex: 1, color: c.foreground, paddingVertical: 12 }]}
        />
        {text !== "" && (
          <Pressable
            onPress={() => setText("")}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}
          >
            <X size={20} color={c.mutedForeground} />
          </Pressable>
        )}
      </View>
    </View>
  )

  // Before anything is asked: where you've been, and a way in without typing.
  const idle = (setFilters: (f: Filters) => void) => (
    <View style={{ gap: 16, paddingTop: 8 }}>
      {recents.length > 0 && (
        <View>
          <Text variant="label" color={c.mutedForeground} style={{ paddingBottom: 4 }}>Recent</Text>
          {recents.map((r) => (
            <View key={r} style={{ flexDirection: "row", alignItems: "center", marginHorizontal: -16 }}>
              <Pressable
                onPress={() => search(r)}
                android_ripple={{ color: c.ripple }}
                accessibilityRole="button"
                accessibilityLabel={`Search for ${r}`}
                style={{ flex: 1, minHeight: 48, flexDirection: "row", alignItems: "center", gap: 16, paddingLeft: 16 }}
              >
                <ClockCounterClockwise size={22} color={c.mutedForeground} />
                <Text numberOfLines={1} style={{ flex: 1 }}>{r}</Text>
              </Pressable>
              <Pressable
                onPress={() => setPrefs({ recentSearches: recents.filter((x) => x !== r) })}
                android_ripple={{ color: c.ripple, radius: 24 }}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${r} from recent searches`}
                style={{ width: 48, height: 48, marginRight: 4, alignItems: "center", justifyContent: "center" }}
              >
                <X size={18} color={c.mutedForeground} />
              </Pressable>
            </View>
          ))}
        </View>
      )}
      <View style={{ gap: 8 }}>
        <Text variant="label" color={c.mutedForeground}>Browse by type</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {TRY.map((k) => {
            const t = FILE_TYPES[k]
            return (
              <Pressable
                key={k}
                onPress={() => setFilters({ type: k })}
                accessibilityRole="button"
                accessibilityLabel={`All ${t.label}`}
                style={{ minHeight: 48, justifyContent: "center" }}
              >
                {({ pressed }) => (
                  <View style={{ height: 40, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: c.input, backgroundColor: pressed ? c.ripple : "transparent" }}>
                    <t.icon size={18} color={t.color} />
                    <Text variant="label">{t.label}</Text>
                  </View>
                )}
              </Pressable>
            )
          })}
        </View>
      </View>
      <Text variant="bodySmall" color={c.mutedForeground}>Search finds names and the text inside your files, including what's shared with you.</Text>
    </View>
  )

  return <Browser source={{ kind: "search", q }} top={top} idle={idle} onOpened={() => remember(q)} />
}
