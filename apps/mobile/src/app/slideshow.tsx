import type { Item, PhotoItem, PreviewResponse } from "@nimbus/shared/api"
import { useQuery } from "@tanstack/react-query"
import { Image } from "expo-image"
import { useKeepAwake } from "expo-keep-awake"
import { router, useLocalSearchParams } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { EyeSlash, Pause, Play, SkipBack, SkipForward, X } from "phosphor-react-native"
import { useEffect, useMemo, useState } from "react"
import { Pressable, View } from "react-native"
import { useReducedMotion } from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { CastBar, CastBtn } from "@/components/cast-ui"
import { Sheet, SheetRow } from "@/components/sheet"
import { useSnack } from "@/components/snackbar"
import { Spinner, Text, IconButton } from "@/components/ui"
import { errorText } from "@/lib/api"
import { castLoad, useCasting } from "@/lib/cast"
import { offlineFile } from "@/lib/file-cache"
import { useApi, useList } from "@/lib/files"
import { memorySlides, photoSlides, type Slide } from "@/lib/memory-slides"
import { useAlbum, useHideMemory, useMemories, usePhotos } from "@/lib/photos"
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

// A memory's way out: hide the photo on screen, its day or its folder. `date` is the day being remembered.
function HideSheet({ item, date, onClose }: { item: PhotoItem; date: string; onClose: () => void }) {
  const hide = useHideMemory()
  return (
    <Sheet onClose={onClose} header={<Text variant="titleSmall" style={{ paddingHorizontal: 20, paddingBottom: 8 }}>Hide from memories</Text>}>
      <SheetRow label="Hide this photo" icon={<EyeSlash size={24} color={c.mutedForeground} />} onPress={() => hide({ kind: "photo", nodeId: item.id }, "Hidden from memories.")} />
      <SheetRow label="Hide this day" icon={<EyeSlash size={24} color={c.mutedForeground} />} onPress={() => hide({ kind: "day", day: date.slice(5) }, "This day is hidden from memories.")} />
      {item.folderId && <SheetRow label="Hide this folder" icon={<EyeSlash size={24} color={c.mutedForeground} />} onPress={() => hide({ kind: "folder", nodeId: item.folderId! }, "This folder is hidden from memories.")} />}
    </Sheet>
  )
}

function Show({ title, slides, loading, startAt = 0, memoryDate }: { title: string; slides: Slide[]; loading: boolean; startAt?: number; memoryDate?: string }) {
  useKeepAwake()
  const api = useApi()
  const { id } = api
  const snack = useSnack()
  const casting = useCasting()
  const inset = useSafeAreaInsets()
  const still = useReducedMotion()
  const [prefs, setPrefs] = usePrefs(id)
  const secs = prefs.slideshowSeconds ?? 5
  const [index, setIndex] = useState(startAt)
  const [hiding, setHiding] = useState(false)
  const [playing, setPlaying] = useState(true)
  const [bars, setBars] = useState(true)
  const [shown, setShown] = useState<string | undefined>()

  const n = slides.length
  const at = n ? index % n : 0
  const slide = slides[at]
  const itemOf = (s?: Slide) => (s?.kind === "photo" ? s.item : undefined)
  const url = useSlideUrl(itemOf(slide))
  const nextUrl = useSlideUrl(n > 1 ? itemOf(slides[(at + 1) % n]) : undefined)
  // The TV shows the same photos at the same pace; a title card leaves the last photo up.
  const photo = itemOf(slide)
  useEffect(() => {
    if (!casting || !photo) return
    castLoad(api, { item: photo, kind: "image" }).catch((e) => snack({ text: errorText(e), error: true }))
  }, [casting, photo, api, snack])
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
        accessibilityLabel={`${slide.kind === "card" ? `${slide.title}, ${slide.caption}` : slide.item.name}, ${at + 1} of ${n}. ${bars ? "Hide" : "Show"} controls`}
        style={{ flex: 1 }}
      >
        {slide.kind === "card" ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 32 }}>
            <Text variant="headline" style={{ textAlign: "center" }}>{slide.title}</Text>
            <Text variant="body" color={c.mutedForeground} style={{ textAlign: "center" }}>{slide.caption}</Text>
          </View>
        ) : shown ? <Image source={{ uri: shown }} style={{ flex: 1 }} contentFit="contain" transition={still ? 0 : 500} accessibilityIgnoresInvertColors /> : <Spinner />}
      </Pressable>

      {bars && (
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, paddingTop: inset.top, paddingHorizontal: 4, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(0,0,0,0.6)" }}>
          <IconButton icon={X} label="Close slideshow" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text variant="titleSmall" numberOfLines={1}>{title}</Text>
            <Text variant="caption" color={c.mutedForeground} style={{ fontVariant: ["tabular-nums"] }}>{at + 1} of {n}</Text>
          </View>
          <CastBtn />
          {memoryDate && slide.kind === "photo" && <IconButton icon={EyeSlash} label="Hide from memories" onPress={() => setHiding(true)} />}
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
      <CastBar bottom={inset.bottom + (bars ? 130 : 24)} />
      {hiding && memoryDate && slide.kind === "photo" && <HideSheet item={slide.item as PhotoItem} date={memoryDate} onClose={() => setHiding(false)} />}
    </View>
  )
}

function TimelineShow() {
  const photos = usePhotos()
  const slides = useMemo(() => photoSlides(photos.items), [photos.items])
  return <Show title="Photos" slides={slides} loading={photos.isPending} />
}

// On this day: a title card for each past year, starting at `year` when a card was tapped.
function MemoriesShow({ date, year }: { date: string; year?: string }) {
  const memories = useMemories(date)
  const slides = useMemo(() => memorySlides(memories.data?.years ?? []), [memories.data])
  const startAt = Math.max(0, slides.findIndex((s) => s.kind === "card" && String(s.year) === year))
  return <Show key={slides.length ? "ready" : "wait"} title="On this day" slides={slides} loading={memories.isPending} startAt={startAt} memoryDate={date} />
}

function AlbumShow({ id, name }: { id: string; name?: string }) {
  const album = useAlbum(id)
  const slides = useMemo(() => photoSlides(album.data?.items ?? []), [album.data])
  return <Show title={name ?? album.data?.album.name ?? "Album"} slides={slides} loading={album.isPending} />
}

function FolderShow({ id, name }: { id: string; name?: string }) {
  const list = useList({ kind: "folder", id }, { sort: "name", order: "asc" })
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = list
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage])
  const slides = useMemo(() => photoSlides(list.items), [list.items])
  return <Show title={name ?? "Slideshow"} slides={slides} loading={list.isPending} />
}

export default function Slideshow() {
  const { folder, name, memories, year, album } = useLocalSearchParams<{ folder?: string; name?: string; memories?: string; year?: string; album?: string }>()
  if (memories) return <MemoriesShow date={memories} year={year} />
  if (album) return <AlbumShow id={album} name={name} />
  return folder ? <FolderShow id={folder} name={name} /> : <TimelineShow />
}
