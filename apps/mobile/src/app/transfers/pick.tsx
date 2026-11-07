import { formatBytes } from "@nimbus/shared/file-rules"
import { router } from "expo-router"
import { ArrowLeft, CaretRight, CheckSquare, Square } from "phosphor-react-native"
import { useMemo, useState } from "react"
import { ActivityIndicator, FlatList, Pressable, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { FileIcon } from "@/components/file-icon"
import { Bar, Button, IconButton, Text } from "@/components/ui"
import { useList, type Source } from "@/lib/files"
import { pickerDone, pickerStart, type Picked } from "@/lib/sent"
import { c } from "@/lib/theme"

type Place = { id: string | null; name: string }
const ROOT: Place = { id: null, name: "My files" }

// Choose files and folders of mine for a transfer: tap a box to pick, tap a folder to look inside.
export default function PickFromNimbus() {
  const inset = useSafeAreaInsets()
  const [stack, setStack] = useState<Place[]>([ROOT])
  const [chosen, setChosen] = useState(() => new Map(pickerStart().map((p) => [p.id, p])))
  const here = stack[stack.length - 1]
  const source: Source = here.id ? { kind: "folder", id: here.id } : { kind: "files" }
  const list = useList(source, { sort: "name", order: "asc" })
  const items = useMemo(() => list.items.filter((i) => !i.shortcut), [list.items])

  const toggle = (p: Picked) =>
    setChosen((m) => {
      const next = new Map(m)
      if (next.has(p.id)) next.delete(p.id)
      else next.set(p.id, p)
      return next
    })
  const back = () => (stack.length > 1 ? setStack((s) => s.slice(0, -1)) : router.back())

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Bar>
        <IconButton icon={ArrowLeft} label="Back" onPress={back} />
        <View style={{ flex: 1 }}>
          <Text variant="title" numberOfLines={1} accessibilityRole="header">{here.name}</Text>
          <Text variant="caption" color={c.mutedForeground}>Choose what to send</Text>
        </View>
      </Bar>
      <FlatList
        style={{ flex: 1 }}
        data={items}
        keyExtractor={(i) => i.id}
        onEndReached={() => list.hasNextPage && !list.isFetchingNextPage && list.fetchNextPage()}
        ListEmptyComponent={
          list.isPending ? (
            <ActivityIndicator color={c.mutedForeground} accessibilityLabel="Loading" style={{ margin: 24 }} />
          ) : (
            <Text color={c.mutedForeground} style={{ padding: 20 }}>{list.isError ? list.error.message : "Nothing in this folder."}</Text>
          )
        }
        renderItem={({ item: i }) => {
          const on = chosen.has(i.id)
          const p = { id: i.id, name: i.name, kind: i.kind, mime: i.mime, size: i.size }
          return (
            <View style={{ minHeight: 56, flexDirection: "row", alignItems: "center" }}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={`Select ${i.name}`}
                android_ripple={{ color: c.ripple }}
                onPress={() => toggle(p)}
                style={{ width: 56, height: 56, alignItems: "center", justifyContent: "center" }}
              >
                {on ? <CheckSquare size={24} weight="fill" color={c.brand} /> : <Square size={24} color={c.mutedForeground} />}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                android_ripple={{ color: c.ripple }}
                onPress={() => (i.kind === "folder" ? setStack((s) => [...s, { id: i.id, name: i.name }]) : toggle(p))}
                style={{ flex: 1, minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, paddingRight: 20 }}
              >
                <FileIcon item={i} />
                <Text numberOfLines={1} style={{ flex: 1 }}>{i.name}</Text>
                {i.kind === "folder" ? (
                  <CaretRight size={20} color={c.mutedForeground} />
                ) : (
                  <Text variant="caption" color={c.mutedForeground} style={{ fontVariant: ["tabular-nums"] }}>{formatBytes(i.size)}</Text>
                )}
              </Pressable>
            </View>
          )
        }}
      />
      <View style={{ padding: 16, paddingBottom: inset.bottom + 16, borderTopWidth: 1, borderTopColor: c.border }}>
        <Button
          label={chosen.size ? `Add ${chosen.size} ${chosen.size === 1 ? "item" : "items"}` : "Done"}
          onPress={() => {
            pickerDone([...chosen.values()])
            router.back()
          }}
        />
      </View>
    </View>
  )
}
