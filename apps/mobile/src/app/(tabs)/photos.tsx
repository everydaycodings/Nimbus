import type { PhotoItem } from "@nimbus/shared/api"
import { typeKeyOf } from "@nimbus/shared/file-rules"
import { monthTitle } from "@nimbus/shared/photos"
import { Image } from "expo-image"
import { router } from "expo-router"
import { GridFour, Play, Slideshow, SquaresFour } from "phosphor-react-native"
import { memo, useCallback, useMemo, useRef, useState } from "react"
import { FlatList, Pressable, RefreshControl, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native"
import { Gesture, GestureDetector } from "react-native-gesture-handler"
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from "react-native-reanimated"

import { FileIcon } from "@/components/file-icon"
import { Bar, Button, IconButton, Spinner, Text } from "@/components/ui"
import { useApi } from "@/lib/files"
import { photoRows, type PhotoRow } from "@/lib/photo-rows"
import { thumbSource, usePhotos } from "@/lib/photos"
import { openPreview } from "@/lib/preview-session"
import { usePrefs } from "@/lib/prefs"
import { c, radius } from "@/lib/theme"

// Tiles per row on a phone; a tablet's wide list gets twice as many.
const LEVELS = [3, 5, 7]
const GAP = 2
const MONTH_H = 48
const HANDLE_H = 44
const LONG = new Date(0)

const Tile = memo(function Tile({ photo, size, account, onPress }: { photo: PhotoItem; size: number; account: { server: string; token: string }; onPress: () => void }) {
  const source = useMemo(() => (photo.thumb ? thumbSource(account, photo) : null), [account, photo])
  const video = typeKeyOf("file", photo.mime, photo.name) === "video"
  const when = new Date(photo.takenAt).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: c.ripple }}
      accessibilityRole="button"
      accessibilityLabel={`${video ? "Video" : "Photo"}, ${photo.name}, ${when}`}
      style={{ width: size, height: size, backgroundColor: c.card, alignItems: "center", justifyContent: "center", overflow: "hidden" }}
    >
      {source ? (
        <Image source={source} style={{ width: size, height: size }} contentFit="cover" cachePolicy="memory-disk" recyclingKey={photo.id} accessibilityIgnoresInvertColors />
      ) : (
        <FileIcon item={photo} size={size > 90 ? 32 : 20} />
      )}
      {video && (
        <View style={{ position: "absolute", right: 6, bottom: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" }}>
          <Play size={11} weight="fill" color="#fff" />
        </View>
      )}
    </Pressable>
  )
})

// The row at a scroll offset, by bisecting the running offsets.
function rowAt(layout: { offset: number }[], y: number) {
  let lo = 0
  let hi = layout.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (layout[mid].offset <= y) lo = mid
    else hi = mid - 1
  }
  return lo
}

// A strip along the right edge: drag it to jump through the library, with the month you are at.
function FastScroller({ height, total, scrollY, rows, layout, onJump }: { height: number; total: number; scrollY: { value: number }; rows: PhotoRow[]; layout: { offset: number }[]; onJump: (y: number) => void }) {
  const [drag, setDrag] = useState<number | null>(null)
  const span = Math.max(1, total - height)
  const room = Math.max(1, height - HANDLE_H)
  const handle = useAnimatedStyle(() => ({ transform: [{ translateY: Math.max(0, Math.min(1, scrollY.value / span)) * room }] }))
  const at = (y: number) => {
    const f = Math.max(0, Math.min(1, (y - HANDLE_H / 2) / room))
    const offset = f * span
    onJump(offset)
    setDrag(offset)
  }
  const month = drag === null ? null : rows[rowAt(layout, drag)]?.month
  return (
    <View
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => at(e.nativeEvent.locationY)}
      onResponderMove={(e) => at(e.nativeEvent.locationY)}
      onResponderRelease={() => setDrag(null)}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Scroll through your photos by date"
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(e) => onJump(Math.max(0, Math.min(span, (drag ?? scrollY.value) + (e.nativeEvent.actionName === "increment" ? 1 : -1) * height)))}
      style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 32 }}
    >
      <Animated.View pointerEvents="none" style={[{ position: "absolute", right: 4, top: 0, width: drag === null ? 4 : 6, height: HANDLE_H, borderRadius: 3, backgroundColor: drag === null ? "rgba(255,255,255,0.35)" : c.brand }, handle]}>
        {month && (
          <View style={{ position: "absolute", right: 16, top: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: c.muted, borderWidth: 1, borderColor: c.border }}>
            <Text variant="label" numberOfLines={1}>{monthTitle(month, LONG)}</Text>
          </View>
        )}
      </Animated.View>
    </View>
  )
}

export default function Photos() {
  const { account, id } = useApi()
  const [prefs, setPrefs] = usePrefs(id)
  const photos = usePhotos()
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [refreshing, setRefreshing] = useState(false)
  const list = useRef<FlatList<PhotoRow>>(null)
  const scrollY = useSharedValue(0)

  const level = Math.max(0, LEVELS.indexOf(prefs.photoColumns ?? LEVELS[0]))
  const perRow = LEVELS[level] * (box.w >= 560 ? 2 : 1)
  const size = Math.floor((box.w - GAP * (perRow - 1)) / perRow)
  const rows = useMemo(() => photoRows(photos.items, perRow), [photos.items, perRow])
  const layout = useMemo(
    () =>
      rows.reduce<{ length: number; offset: number }[]>((all, r) => {
        const last = all[all.length - 1]
        all.push({ length: r.type === "month" ? MONTH_H : size + GAP, offset: last ? last.offset + last.length : 0 })
        return all
      }, []),
    [rows, size]
  )
  const total = layout.length ? layout[layout.length - 1].offset + layout[layout.length - 1].length : 0

  // Pinch in for bigger photos, out for more of them; the button does the same one step at a time.
  const step = useCallback(
    (by: number) => setPrefs({ photoColumns: LEVELS[Math.max(0, Math.min(LEVELS.length - 1, level + by))] }),
    [level, setPrefs]
  )
  const pinch = Gesture.Pinch().onEnd((e) => {
    if (e.scale > 1.2) runOnJS(step)(-1)
    else if (e.scale < 0.83) runOnJS(step)(1)
  })

  const { items, hasNextPage, fetchNextPage } = photos
  const open = useCallback(
    (index: number) =>
      openPreview({
        items,
        index,
        role: "owner",
        more: async () => {
          if (!hasNextPage) return null
          const next = await fetchNextPage()
          return next.data?.pages.flatMap((p) => p.items) ?? null
        },
      }),
    [items, hasNextPage, fetchNextPage]
  )

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.value = e.nativeEvent.contentOffset.y
  }
  const onLayout = (e: LayoutChangeEvent) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
  const refresh = async () => {
    setRefreshing(true)
    await photos.refetch().catch(() => {})
    setRefreshing(false)
  }

  const header = (
    <Bar>
      <View style={{ flex: 1, paddingLeft: 12 }}>
        <Text variant="title" numberOfLines={1} accessibilityRole="header">Photos</Text>
        {photos.total > 0 && (
          <Text variant="caption" color={c.mutedForeground} style={{ fontVariant: ["tabular-nums"] }}>
            {photos.total.toLocaleString()} photos and videos
          </Text>
        )}
      </View>
      {photos.items.length > 0 && (
        <>
          <IconButton icon={level === 0 ? SquaresFour : GridFour} label={`Grid size, ${perRow} per row. Change`} onPress={() => setPrefs({ photoColumns: LEVELS[(level + 1) % LEVELS.length] })} />
          <IconButton icon={Slideshow} label="Slideshow" onPress={() => router.push({ pathname: "/slideshow", params: { source: "photos" } })} />
        </>
      )}
    </Bar>
  )

  if (photos.isPending)
    return (
      <View style={{ flex: 1 }}>
        {header}
        <Spinner />
      </View>
    )
  if (photos.isError && !photos.items.length)
    return (
      <View style={{ flex: 1 }}>
        {header}
        <View style={{ alignItems: "center", padding: 24, gap: 12 }}>
          <Text variant="bodySmall" color={c.mutedForeground} style={{ textAlign: "center" }}>{(photos.error as Error).message}</Text>
          <Button variant="outlined" label="Try again" busy={photos.isFetching} onPress={() => photos.refetch()} />
        </View>
      </View>
    )
  if (!photos.items.length)
    return (
      <View style={{ flex: 1 }}>
        {header}
        <View style={{ alignItems: "center", paddingVertical: 64, paddingHorizontal: 24, gap: 8 }}>
          <Text variant="titleSmall" style={{ textAlign: "center" }}>No photos yet</Text>
          <Text variant="bodySmall" color={c.mutedForeground} style={{ textAlign: "center" }}>
            Photos and videos you upload or back up show up here, newest first. Vaults and Trash are left out.
          </Text>
        </View>
      </View>
    )

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      {header}
      <GestureDetector gesture={pinch}>
        <View style={{ flex: 1 }} onLayout={onLayout}>
          {box.w > 0 && (
            <FlatList
              ref={list}
              data={rows}
              keyExtractor={(r) => r.key}
              getItemLayout={(_, i) => ({ ...layout[i], index: i })}
              onScroll={onScroll}
              scrollEventThrottle={16}
              initialNumToRender={12}
              windowSize={7}
              removeClippedSubviews
              contentContainerStyle={{ paddingBottom: 16 }}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[c.foreground]} progressBackgroundColor={c.muted} />}
              renderItem={({ item: r }) =>
                r.type === "month" ? (
                  <View style={{ height: MONTH_H, justifyContent: "flex-end", paddingHorizontal: 16, paddingBottom: 8 }}>
                    <Text variant="titleSmall" accessibilityRole="header">{r.title}</Text>
                  </View>
                ) : (
                  <View style={{ flexDirection: "row", gap: GAP, marginBottom: GAP, height: size }}>
                    {r.items.map((p, i) => (
                      <Tile key={p.id} photo={p} size={size} account={account} onPress={() => open(r.start + i)} />
                    ))}
                  </View>
                )
              }
            />
          )}
          {total > box.h * 2 && <FastScroller height={box.h} total={total} scrollY={scrollY} rows={rows} layout={layout} onJump={(y) => list.current?.scrollToOffset({ offset: y, animated: false })} />}
        </View>
      </GestureDetector>
    </View>
  )
}
