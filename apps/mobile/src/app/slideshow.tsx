import type { Item, PreviewResponse } from "@nimbus/shared/api"
import { typeKeyOf } from "@nimbus/shared/file-rules"
import { useQuery } from "@tanstack/react-query"
import { Image } from "expo-image"
import { useKeepAwake } from "expo-keep-awake"
import { router, useLocalSearchParams } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { Pause, Play, SkipBack, SkipForward, X } from "phosphor-react-native"
import { useEffect, useState } from "react"
import { Pressable, View } from "react-native"
import { useReducedMotion } from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Spinner, Text, IconButton } from "@/components/ui"
import { offlineFile } from "@/lib/file-cache"
import { useApi, useList } from "@/lib/files"
import { usePhotos } from "@/lib/photos"
import { usePrefs } from "@/lib/prefs"
import { c, radius } from "@/lib/theme"

const SECONDS = [3, 5, 10] as const
const HIDE_BARS_MS = 3000

// A photo's full-size address: the phone's offline copy, else a fresh download link.
function useSlideUrl(item: Item | undefined) {
  const api = useApi()
  const kept = item ? offlineFile(api.id, item.id, item.version) : null
  const query = useQuery({
    queryKey: [api.id, "preview", item?.id, undefined],
    enabled: !!item && !kept?.exists,
    staleTime: 50 * 60_000,
    queryFn: () => api.get<PreviewResponse>(`/items/${item!.id}/preview`),
  })
  return kept?.exists ? kept.uri : query.data?.url
}

function Show({ title, items, loading }: { title: string; items: Item[]; loading: boolean }) {
  useKeepAwake()
  const { id } = useApi()
  const inset = useSafeAreaInsets()
  const still = useReducedMotion()
  const [prefs, setPrefs] = usePrefs(id)
  const secs = prefs.slideshowSeconds ?? 5
  const images = items.filter((i) => i.kind === "file" && typeKeyOf("file", i.mime, i.name) === "image")
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [bars, setBars] = useState(true)
  const [shown, setShown] = useState<string | undefined>()

  const n = images.length
  const at = n ? index % n : 0
  const url = useSlideUrl(images[at])
  const nextUrl = useSlideUrl(n > 1 ? images[(at + 1) % n] : undefined)
  // Keeps the last photo up until the next one has an address.
  if (url && url !== shown) setShown(url)
  useEffect(() => {
    if (nextUrl) void Image.prefetch(nextUrl)
  }, [nextUrl])

  useEffect(() => {
    if (!playing || n < 2) return
    const t = setTimeout(() => setIndex((i) => (i + 1) % n), secs * 1000)
    return () => clearTimeout(t)
  }, [index, playing, secs, n])
  // The bars get out of the way while it plays; a tap brings them back.
  useEffect(() => {
    if (!playing || !bars) return
    const t = setTimeout(() => setBars(false), HIDE_BARS_MS)
    return () => clearTimeout(t)
  }, [playing, bars])

  const skip = (by: number) => {
    setIndex((i) => (i + by + n) % n)
    setBars(true)
  }

  if (!n) {
    if (loading) return <Spinner />
    return (
      <View style={{ flex: 1, backgroundColor: c.background, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 }}>
        <Text variant="titleSmall">No photos to show</Text>
        <IconButton icon={X} label="Close" onPress={() => router.back()} />
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <StatusBar hidden={!bars} style="light" />
      <Pressable
        onPress={() => setBars((b) => !b)}
        accessibilityRole="button"
        accessibilityLabel={`${images[at].name}, ${at + 1} of ${n}. ${bars ? "Hide" : "Show"} controls`}
        style={{ flex: 1 }}
      >
        {shown ? <Image source={{ uri: shown }} style={{ flex: 1 }} contentFit="contain" transition={still ? 0 : 500} accessibilityIgnoresInvertColors /> : <Spinner />}
      </Pressable>

      {bars && (
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, paddingTop: inset.top, paddingHorizontal: 4, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(0,0,0,0.6)" }}>
          <IconButton icon={X} label="Close slideshow" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text variant="titleSmall" numberOfLines={1}>{title}</Text>
            <Text variant="caption" color={c.mutedForeground} style={{ fontVariant: ["tabular-nums"] }}>{at + 1} of {n}</Text>
          </View>
        </View>
      )}
      {bars && (
        <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, paddingBottom: inset.bottom + 8, paddingTop: 8, alignItems: "center", gap: 8, backgroundColor: "rgba(0,0,0,0.6)" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
            <IconButton icon={SkipBack} label="Previous photo" onPress={() => skip(-1)} />
            <IconButton icon={playing ? Pause : Play} label={playing ? "Pause slideshow" : "Play slideshow"} onPress={() => setPlaying((p) => !p)} />
            <IconButton icon={SkipForward} label="Next photo" onPress={() => skip(1)} />
          </View>
          <View accessibilityRole="radiogroup" style={{ flexDirection: "row", gap: 8 }}>
            {SECONDS.map((s) => (
              <Pressable
                key={s}
                onPress={() => setPrefs({ slideshowSeconds: s })}
                accessibilityRole="radio"
                accessibilityState={{ checked: s === secs }}
                accessibilityLabel={`${s} seconds per photo`}
                style={{ minHeight: 48, justifyContent: "center" }}
              >
                <View style={{ height: 36, paddingHorizontal: 16, justifyContent: "center", borderRadius: radius.pill, borderWidth: 1, borderColor: s === secs ? c.brand : c.input, backgroundColor: s === secs ? c.brandWash : "transparent" }}>
                  <Text variant="label" style={{ fontVariant: ["tabular-nums"] }}>{s} s</Text>
                </View>
              </Pressable>
            ))}
          </View>
        </View>
      )}
    </View>
  )
}

function TimelineShow() {
  const photos = usePhotos()
  return <Show title="Photos" items={photos.items} loading={photos.isPending} />
}

function FolderShow({ id, name }: { id: string; name?: string }) {
  const list = useList({ kind: "folder", id }, { sort: "name", order: "asc" })
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = list
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage])
  return <Show title={name ?? "Slideshow"} items={list.items} loading={list.isPending} />
}

export default function Slideshow() {
  const { folder, name } = useLocalSearchParams<{ folder?: string; name?: string }>()
  return folder ? <FolderShow id={folder} name={name} /> : <TimelineShow />
}
