import { router } from "expo-router"
import { ArrowLeft, MagnifyingGlass, X } from "phosphor-react-native"
import { useEffect, useState } from "react"
import { Pressable, TextInput, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Browser } from "@/components/browser"
import { c, radius, type } from "@/lib/theme"

export default function Search() {
  const inset = useSafeAreaInsets()
  const [text, setText] = useState("")
  const [q, setQ] = useState("")

  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250)
    return () => clearTimeout(t)
  }, [text])

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

  return <Browser source={{ kind: "search", q }} top={top} />
}
