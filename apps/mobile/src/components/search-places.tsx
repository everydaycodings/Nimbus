import type { Hit, Item, TextPlace } from "@nimbus/shared/api"
import type { TypeKey } from "@nimbus/shared/file-rules"
import { CaretDown } from "phosphor-react-native"
import { useState } from "react"
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native"

import { Text } from "@/components/ui"
import { usePlaces } from "@/lib/files"
import { c, radius } from "@/lib/theme"
import { clock } from "@/lib/time"

// \u0001 and \u0002 wrap the matched words in a snippet.
export function Snippet({ text, prefix, lines = 2 }: { text: string; prefix?: string; lines?: number }) {
  const [first, ...rest] = text.split("\u0001")
  return (
    <Text variant="caption" color={c.mutedForeground} numberOfLines={lines}>
      {prefix}
      {first}
      {rest.map((part, i) => {
        const [hit, tail] = part.split("\u0002")
        return (
          <Text key={i} variant="caption" color={c.mutedForeground}>
            <Text variant="caption" color={c.foreground} style={{ fontFamily: "Geist_600SemiBold" }}>
              {hit}
            </Text>
            {tail}
          </Text>
        )
      })}
    </Text>
  )
}

const plain = (s: string) => s.replace(/[\u0001\u0002]/g, "")

// Spoken words and look-alike frames say how they were found; on-screen text is just the time.
export const placeLabel = (p: TextPlace) =>
  p.kind === "page" ? `p. ${p.page ?? 1}` : p.kind === "time" ? `${p.source === "speech" ? "Said at " : p.source === "picture" ? "Seen at " : ""}${clock((p.tMs ?? 0) / 1000)}` : "In image"

const placeSpeech = (p: TextPlace) =>
  p.kind === "page" ? `Page ${p.page ?? 1}` : p.kind === "time" ? `${p.source === "speech" ? "Said at" : p.source === "picture" ? "Seen at" : "At"} ${clock((p.tMs ?? 0) / 1000)}` : "In the image"

// "Looks like": the search words match what is in the picture, or a person's name matched.
export function MatchTag({ match }: { match: "picture" | "person" }) {
  return (
    <View style={{ alignSelf: "flex-start", height: 22, paddingHorizontal: 8, borderRadius: radius.pill, justifyContent: "center", backgroundColor: c.brandWash, borderWidth: 1, borderColor: c.border }}>
      <Text variant="caption" color={c.brand}>{match === "picture" ? "Looks like" : "Person"}</Text>
    </View>
  )
}

function PlaceRow({ place, onPress }: { place: TextPlace; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: c.ripple }}
      accessibilityRole="button"
      accessibilityLabel={`${placeSpeech(place)}${place.snippet ? `: ${plain(place.snippet)}` : place.source === "picture" ? ": looks like your search" : ""}. Open there`}
      style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 }}
    >
      <View style={{ minWidth: 48, height: 24, paddingHorizontal: 8, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: c.brandWash, borderWidth: 1, borderColor: c.border }}>
        <Text variant="caption" color={c.brand} style={{ fontVariant: ["tabular-nums"] }} numberOfLines={1}>
          {placeLabel(place)}
        </Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        {place.snippet ? <Snippet text={place.snippet} /> : place.source === "picture" ? <Text variant="caption" color={c.mutedForeground}>Looks like your search</Text> : null}
      </View>
    </Pressable>
  )
}

// Up to three places a search found in one file, and the rest on demand.
export function Places({ hit, q, onPlace }: { hit: Hit; q: string; onPlace: (item: Item, place: TextPlace) => void }) {
  const [all, setAll] = useState(false)
  const more = hit.moreCount ?? 0
  const rest = usePlaces(hit.id, q, all)
  const shown = all && rest.data ? rest.data : (hit.places ?? [])
  return (
    <View>
      {shown.map((p, i) => (
        <PlaceRow key={`${p.page ?? p.tMs ?? i}-${i}`} place={p} onPress={() => onPlace(hit, p)} />
      ))}
      {more > 0 && !(all && rest.data) && (
        <Pressable
          onPress={() => (rest.isError ? rest.refetch() : setAll(true))}
          disabled={all && rest.isFetching}
          android_ripple={{ color: c.ripple }}
          accessibilityRole="button"
          accessibilityLabel={rest.isError ? "Couldn't load the other places. Try again" : `Show ${more} more places`}
          style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 6 }}
        >
          {all && rest.isFetching ? (
            <ActivityIndicator size="small" color={c.mutedForeground} />
          ) : (
            <CaretDown size={16} color={rest.isError ? c.destructive : c.brand} />
          )}
          <Text variant="label" color={rest.isError ? c.destructive : c.brand}>
            {rest.isError ? "Couldn't load. Try again" : `${more} more`}
          </Text>
        </Pressable>
      )}
    </View>
  )
}

const QUICK: { key: TypeKey | undefined; label: string }[] = [
  { key: undefined, label: "All" },
  { key: "image", label: "Images" },
  { key: "video", label: "Videos" },
  { key: "pdf", label: "PDFs" },
  { key: "doc", label: "Documents" },
]

// One tap to narrow a search to a kind of file; the Type chip below has the full list.
export function QuickChips({ type, onType }: { type?: TypeKey; onType: (t: TypeKey | undefined) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
      {QUICK.map((q) => {
        const on = q.key === type
        return (
          <Pressable
            key={q.label}
            onPress={() => onType(q.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={q.key ? `Only ${q.label.toLowerCase()}` : "All kinds of files"}
            style={{ minHeight: 48, justifyContent: "center" }}
          >
            {({ pressed }) => (
              <View style={{ height: 36, paddingHorizontal: 16, justifyContent: "center", borderRadius: radius.pill, borderWidth: 1, borderColor: on ? c.brand : c.input, backgroundColor: on ? c.brandWash : pressed ? c.ripple : "transparent" }}>
                <Text variant="label" color={on ? c.brand : c.foreground}>
                  {q.label}
                </Text>
              </View>
            )}
          </Pressable>
        )
      })}
    </ScrollView>
  )
}
