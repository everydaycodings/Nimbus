import type { TextPlace } from "@nimbus/shared/api"
import { ArrowLeft, CaretDown, CaretUp } from "phosphor-react-native"
import { useEffect, useRef, useState } from "react"
import { ActivityIndicator, TextInput, View } from "react-native"

import { IconButton, Text } from "@/components/ui"
import { usePlaces } from "@/lib/files"
import { c, type } from "@/lib/theme"

// Search inside the open file: the previewer's bar turns into this, and next and previous jump to each place.
export function FindBar({ id, background, onJump, onClose }: { id: string; background: string; onJump: (p: TextPlace) => void; onClose: () => void }) {
  const [text, setText] = useState("")
  const [q, setQ] = useState("")
  const [at, setAt] = useState(0)
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300)
    return () => clearTimeout(t)
  }, [text])

  const found = usePlaces(id, q)
  const parts = found.data ?? []
  const jump = useRef(onJump)
  jump.current = onJump
  // A new set of matches starts at the first.
  useEffect(() => {
    setAt(0)
    if (found.data?.[0]) jump.current(found.data[0])
  }, [found.data])

  const go = (by: 1 | -1) => {
    if (!parts.length) return
    const next = (at + by + parts.length) % parts.length
    setAt(next)
    jump.current(parts[next])
  }

  const status = !q
    ? ""
    : found.isError
      ? "Can't search now"
      : found.isFetching && !found.data
        ? ""
        : parts.length
          ? `${at + 1} of ${parts.length}`
          : "No matches"

  return (
    <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: background }}>
      <IconButton icon={ArrowLeft} label="Close search in file" onPress={onClose} />
      <TextInput
        value={text}
        onChangeText={setText}
        onSubmitEditing={() => go(1)}
        autoFocus
        autoCorrect={false}
        returnKeyType="search"
        placeholder="Find in this file"
        placeholderTextColor={c.mutedForeground}
        selectionColor={c.brand}
        cursorColor={c.brand}
        accessibilityLabel="Find in this file"
        style={[type.body, { flex: 1, minHeight: 48, color: c.foreground }]}
      />
      {found.isFetching && !!q ? (
        <ActivityIndicator size="small" color={c.mutedForeground} accessibilityLabel="Searching" />
      ) : (
        <Text variant="caption" color={found.isError ? c.destructive : c.mutedForeground} style={{ fontVariant: ["tabular-nums"] }} accessibilityLiveRegion="polite">
          {status}
        </Text>
      )}
      <IconButton icon={CaretUp} label="Previous match" onPress={() => go(-1)} color={parts.length ? c.foreground : c.dim} />
      <IconButton icon={CaretDown} label="Next match" onPress={() => go(1)} color={parts.length ? c.foreground : c.dim} />
    </View>
  )
}
