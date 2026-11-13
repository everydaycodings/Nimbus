import type { PhotoPerson } from "@nimbus/shared/api"
import { router } from "expo-router"
import { ArrowLeft, Eye, EyeSlash } from "phosphor-react-native"
import { useState } from "react"
import { Pressable, RefreshControl, ScrollView, View, useWindowDimensions } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { FaceGroupingRow, PersonFace } from "@/components/people-ui"
import { Group } from "@/components/page"
import { Bar, Button, IconButton, Spinner, Text } from "@/components/ui"
import { photosText, useAi, usePeople } from "@/lib/people"
import { c } from "@/lib/theme"

const GAP = 12

function Card({ person, size }: { person: PhotoPerson; size: number }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${person.name ?? "Unnamed person"}, ${photosText(person.photos)}${person.hidden ? ", hidden" : ""}`}
      android_ripple={{ color: c.ripple, borderless: true }}
      onPress={() => router.push({ pathname: "/people/[id]", params: { id: person.id, name: person.name ?? "" } })}
      style={{ width: size, alignItems: "center", gap: 6 }}
    >
      <PersonFace person={person} size={size - 16} />
      <View style={{ alignItems: "center", paddingHorizontal: 2 }}>
        <Text variant="label" color={person.name ? c.foreground : c.mutedForeground} numberOfLines={1}>{person.name ?? "Add a name"}</Text>
        <Text variant="caption" color={c.mutedForeground} numberOfLines={1}>{photosText(person.photos)}</Text>
      </View>
    </Pressable>
  )
}

// Everyone Nimbus found in my photos, named first. Hidden people live behind a switch.
export default function People() {
  const ai = useAi()
  const inset = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const [hidden, setHidden] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const people = usePeople(hidden, ai.facesOn)
  // Counts come from the visible list's response, so it is asked for even while hidden ones show.
  const visible = usePeople(false, ai.facesOn)
  const inner = Math.min(width, 640) - 32
  const perRow = inner >= 480 ? 4 : 3
  const size = Math.floor((inner - GAP * (perRow - 1)) / perRow)
  const hiddenCount = visible.data?.hiddenCount ?? 0
  const list = people.data?.people ?? []

  const body = !ai.faces ? (
    <Empty title="People aren't available" text="Your server doesn't have face grouping turned on for you." />
  ) : !ai.facesOn ? (
    <View style={{ gap: 16 }}>
      <Empty title="Face grouping is off" text="Turn it on and Nimbus sorts new and existing photos by who is in them. Everything stays on your server." />
      <Group><FaceGroupingRow /></Group>
    </View>
  ) : people.isPending ? (
    <View style={{ height: 240 }}><Spinner /></View>
  ) : people.isError && !people.data ? (
    <View style={{ alignItems: "center", padding: 24, gap: 12 }}>
      <Text variant="bodySmall" color={c.mutedForeground} style={{ textAlign: "center" }}>{people.error.message}</Text>
      <Button variant="outlined" label="Try again" busy={people.isFetching} onPress={() => people.refetch()} />
    </View>
  ) : list.length === 0 ? (
    hidden ? (
      <Empty title="No hidden people" text="People you hide from this page show up here." />
    ) : (
      <Empty title="No people yet" text="Nimbus is still looking through your photos, or hasn't found a face yet. New photos are looked at as they come in." />
    )
  ) : (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: GAP }}>
      {list.map((p) => <Card key={p.id} person={p} size={size} />)}
    </View>
  )

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Bar>
        <IconButton icon={ArrowLeft} label="Back" onPress={() => router.back()} />
        <Text variant="title" numberOfLines={1} accessibilityRole="header" style={{ flex: 1 }}>{hidden ? "Hidden people" : "People"}</Text>
        {ai.facesOn && (hiddenCount > 0 || hidden) && (
          <IconButton icon={hidden ? Eye : EyeSlash} label={hidden ? "Show people" : `Hidden people, ${hiddenCount}`} onPress={() => setHidden((h) => !h)} />
        )}
      </Bar>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true)
              await Promise.all([people.refetch(), visible.refetch()]).catch(() => {})
              setRefreshing(false)
            }}
            colors={[c.foreground]}
            progressBackgroundColor={c.muted}
          />
        }
        contentContainerStyle={{ alignSelf: "center", width: "100%", maxWidth: 640, padding: 16, paddingBottom: inset.bottom + 24 }}
      >
        {body}
      </ScrollView>
    </View>
  )
}

function Empty({ title, text }: { title: string; text: string }) {
  return (
    <View style={{ alignItems: "center", paddingVertical: 48, paddingHorizontal: 8, gap: 8 }}>
      <Text variant="titleSmall" style={{ textAlign: "center" }}>{title}</Text>
      <Text variant="bodySmall" color={c.mutedForeground} style={{ textAlign: "center" }}>{text}</Text>
    </View>
  )
}
