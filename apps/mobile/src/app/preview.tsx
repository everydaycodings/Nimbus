import type { Item, Version } from "@nimbus/shared/api"
import { router, useFocusEffect } from "expo-router"
import { StatusBar } from "expo-status-bar"
import type { VideoPlayer } from "expo-video"
import { ArrowSquareOut, DownloadSimple, DotsThreeVertical, ShareNetwork, X } from "phosphor-react-native"
import { useCallback, useEffect, useRef, useState } from "react"
import { BackHandler, FlatList, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native"
import Animated, { useAnimatedStyle, useReducedMotion, withTiming } from "react-native-reanimated"
import { useSafeAreaFrame, useSafeAreaInsets } from "react-native-safe-area-context"

import { Directory } from "expo-file-system"

import { FileSheets } from "@/components/file-sheets"
import { AudioPage, CollaboraView, ImagePage, NoPreview, VideoPage, WebPage, type PageProps } from "@/components/preview-pages"
import { useSnack } from "@/components/snackbar"
import { IconButton, Text } from "@/components/ui"
import { errorText } from "@/lib/api"
import { shareable, useApi, useDetails, useFileActions, type FileSheet } from "@/lib/files"
import { planFor, type Plan } from "@/lib/preview-rules"
import { clearPreview, previewSession } from "@/lib/preview-session"
import { useTransfers } from "@/lib/transfers"
import { Secure, useVaultLock } from "@/components/vault-lock"
import { useVaultItem } from "@/components/vault-item"
import { vaultDirUri, vaultNative } from "@/lib/vault"
import { frameToWebp } from "@/lib/thumbs"
import { c } from "@/lib/theme"

const BAR = 56
const LOAD_MORE_WITHIN = 3
const COUNTS_AS_OPENED_MS = 800
const HIDE_WHILE_PLAYING_MS = 3000

// A vault file is decrypted whole to a temp copy, so every viewer reads it locally; Collabora can't see it.
function planOf(name: string, mime: string | null, size: number): Plan {
  const plan = planFor(name, mime, size)
  if (!previewSession()?.vault) return plan
  if (plan.show === "collabora") return { show: "none", reason: "This type can't be previewed in a vault. Use Open with." }
  return plan.show === "web" ? { ...plan, fetch: "cache" } : plan
}

function Page(props: PageProps & { near: boolean }) {
  const { item, version, near, active, top } = props
  const plan = planOf(item.name, version ? version.mime : item.mime, version?.size ?? item.size)
  switch (plan.show) {
    case "image":
      return <ImagePage {...props} />
    case "video":
      return <VideoPage {...props} />
    case "audio":
      return <AudioPage {...props} />
    case "web":
      return near ? <WebPage {...props} plan={plan} /> : null
    case "collabora":
      return <CollaboraView item={item} version={version} top={top} active={active} />
    case "none":
      return (
        <View style={{ flex: 1, paddingTop: top }}>
          <NoPreview item={item} version={version} reason={plan.reason} />
        </View>
      )
  }
}

export default function Preview() {
  const session = useRef(previewSession()).current
  // Android rebuilt the app while this screen was open, so there's no list to go back into.
  useEffect(() => {
    if (!session) router.back()
  }, [session])
  return session ? <Previewer session={session} /> : null
}

function Previewer({ session }: { session: NonNullable<ReturnType<typeof previewSession>> }) {
  const api = useApi()
  const inset = useSafeAreaInsets()
  const still = useReducedMotion()
  // The whole screen, edge to edge: the window size leaves out the system bars.
  const { width, height } = useSafeAreaFrame()
  const actions = useFileActions()
  const snack = useSnack()
  const { download } = useTransfers()

  const version: Version | undefined = session.version
  const [items, setItems] = useState<Item[]>(session.items)
  const [index, setIndex] = useState(session.index)
  const [bars, setBars] = useState(true)
  const [zoomed, setZoomed] = useState(false)
  const [sheet, setSheet] = useState<FileSheet | null>(null)
  const player = useRef<VideoPlayer | null>(null)
  const [hasPlayer, setHasPlayer] = useState(false)

  const shown = items[index]
  // Fresh details keep the name, star and thumbnail right after an action in the ⋯ menu.
  const vaultId = session.vault
  const vaultItem = useVaultItem(vaultId)
  const { touch, isOpen } = useVaultLock()
  // Locked while showing (idle, background, sign-out): the decrypted page goes with it.
  const locked = !!vaultId && !isOpen(vaultId)
  useEffect(() => {
    if (locked) router.back()
  }, [locked])
  const details = useDetails(shown?.id ?? "", !vaultId)
  const item: Item = (details.data?.item?.id === shown?.id ? details.data?.item : null) ?? shown
  const plan = shown ? planOf(item.name, version ? version.mime : item.mime, version?.size ?? item.size) : null
  const immersive = plan?.show === "image" || plan?.show === "video"
  const top = inset.top + BAR

  // Counts as opened once it's been looked at, so swiping past doesn't fill Recent.
  useEffect(() => {
    if (!shown || version || vaultId) return
    const t = setTimeout(() => {
      api.get(`/items/${shown.id}/preview?open=1`).catch(() => {})
    }, COUNTS_AS_OPENED_MS)
    return () => clearTimeout(t)
  }, [shown, version, api, vaultId])

  // A vault's temp copies go when the previewer closes.
  useEffect(
    () => () => {
      if (!vaultId) return
      try {
        const dir = new Directory(vaultDirUri(vaultNative!, api.id, vaultId))
        if (dir.exists) dir.delete()
      } catch {}
      clearPreview()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on close only
    []
  )

  // Every new file starts with the bars showing, so its name is seen.
  useEffect(() => {
    setBars(true)
  }, [index])

  // Swiping near the end of what's loaded asks the list for its next page.
  const asking = useRef(false)
  useEffect(() => {
    if (!session.more || asking.current || index < items.length - LOAD_MORE_WITHIN) return
    asking.current = true
    session.more().then((next) => {
      if (next) setItems((have) => [...have, ...next.filter((n) => !have.some((h) => h.id === n.id))])
      asking.current = false
    }, () => {
      asking.current = false
    })
  }, [index, items.length, session])

  // Native video controls take the taps, so the bar follows playback there instead.
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isPlaying = useRef(false)
  const onPlaying = useCallback((playing: boolean) => {
    isPlaying.current = playing
    if (hideTimer.current) clearTimeout(hideTimer.current)
    if (playing) hideTimer.current = setTimeout(() => setBars(false), HIDE_WHILE_PLAYING_MS)
    else setBars(true)
  }, [])
  const onTouched = useCallback(() => {
    setBars(true)
    onPlaying(isPlaying.current)
  }, [onPlaying])
  useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
  }, [])

  const onTap = useCallback(() => setBars((b) => !b), [])
  const onScrollDown = useCallback((down: boolean) => setBars(!down), [])
  const onPlayer = useCallback((p: VideoPlayer | null) => {
    player.current = p
    setHasPlayer(!!p)
  }, [])

  const onSwiped = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / width)
    if (next !== index && next >= 0 && next < items.length) goTo(next)
  }
  // The new page says what it needs when it becomes active.
  const goTo = (next: number) => {
    setZoomed(false)
    setIndex(next)
  }
  const listRef = useRef<FlatList<Item>>(null)
  const onEdge = (by: number) => {
    const next = index + by
    if (version || next < 0 || next >= items.length) return
    listRef.current?.scrollToIndex({ index: next, animated: !still })
    goTo(next)
  }
  const latestEdge = useRef(onEdge)
  latestEdge.current = onEdge
  const edge = useCallback((by: number) => latestEdge.current(by), [])

  // The file left this list: show its neighbour, or leave if it was the last.
  const onTrashed = useCallback(
    (gone: Item[]) => {
      const left = items.filter((i) => !gone.some((g) => g.id === i.id))
      if (!left.length) return router.back()
      setItems(left)
      setZoomed(false)
      setIndex((i) => Math.min(i, left.length - 1))
    },
    [items]
  )

  const useFrame = async () => {
    const p = player.current
    if (!p) return
    try {
      await actions.setThumb(item, await frameToWebp(p, p.currentTime))
      snack({ text: "Thumbnail updated." })
    } catch (e) {
      snack({ text: errorText(e), error: true })
    }
  }

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        if (!sheet) return false
        setSheet(null)
        return true
      })
      return () => sub.remove()
    }, [sheet])
  )

  const barStyle = useAnimatedStyle(() => {
    const visible = bars
    return {
      opacity: still ? (visible ? 1 : 0) : withTiming(visible ? 1 : 0, { duration: 150 }),
      transform: [{ translateY: still ? 0 : withTiming(visible ? 0 : -16, { duration: 150 }) }],
    }
  })

  const renderItem = useCallback(
    ({ item: it, index: i }: { item: Item; index: number }) => (
      <View style={{ width, height }}>
        <Page
          item={it}
          version={version}
          active={i === index}
          near={Math.abs(i - index) <= 1}
          top={top}
          bottom={inset.bottom}
          onTap={onTap}
          onScrollDown={onScrollDown}
          onZoom={setZoomed}
          onEdge={edge}
          onPlaying={onPlaying}
          onPlayer={onPlayer}
          onTouched={onTouched}
        />
      </View>
    ),
    [width, height, index, version, top, inset.bottom, edge, onTap, onScrollDown, onPlaying, onPlayer, onTouched]
  )

  if (!shown) return <View style={{ flex: 1, backgroundColor: c.background }} />

  return (
    <View style={{ flex: 1, backgroundColor: immersive ? "#000" : c.background }} onTouchStartCapture={vaultId ? touch : undefined}>
      {vaultId && <Secure />}
      <StatusBar hidden={immersive && !bars} style="light" />
      <FlatList
        ref={listRef}
        key={width}
        data={items}
        renderItem={renderItem}
        keyExtractor={(i) => i.id}
        extraData={index}
        horizontal
        pagingEnabled
        scrollEnabled={!zoomed && !version}
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={index}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        initialNumToRender={1}
        maxToRenderPerBatch={1}
        windowSize={3}
        onMomentumScrollEnd={onSwiped}
        keyboardShouldPersistTaps="handled"
      />

      {/* A document scrolls under the bar, but never under the clock. */}
      {!immersive && <View style={{ position: "absolute", top: 0, left: 0, right: 0, height: inset.top, backgroundColor: c.background }} />}
      <Animated.View
        pointerEvents={bars ? "box-none" : "none"}
        accessibilityElementsHidden={!bars}
        style={[
          {
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            paddingTop: inset.top,
            minHeight: top,
            paddingHorizontal: 4,
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            backgroundColor: immersive ? "rgba(0,0,0,0.6)" : c.background,
          },
          barStyle,
        ]}
      >
        <IconButton icon={X} label="Close preview" onPress={() => router.back()} />
        <View style={{ flex: 1 }}>
          <Text variant="titleSmall" numberOfLines={1}>
            {item.name}
          </Text>
          {version && (
            <Text variant="caption" color={c.mutedForeground}>
              Older version · v{version.number}
            </Text>
          )}
        </View>
        {vaultItem && (
          <>
            <IconButton icon={ArrowSquareOut} label="Open with" onPress={() => vaultItem.openWith(item)} />
            <IconButton icon={DownloadSimple} label="Download" onPress={() => vaultItem.download(item)} />
          </>
        )}
        {!vaultId && !version && shareable(item, session.role) && (
          <IconButton icon={ShareNetwork} label="Share" onPress={() => router.push({ pathname: "/share/[id]", params: { id: item.id, name: item.name } })} />
        )}
        {!vaultId && <IconButton icon={DownloadSimple} label="Download" onPress={() => download([item], version)} />}
        {!vaultId && <IconButton icon={DotsThreeVertical} label="More actions" onPress={() => setSheet({ kind: "actions", items: [item] })} />}
      </Animated.View>

      {vaultItem?.dialog}
      {!vaultId && <FileSheets
        sheet={sheet}
        onChange={setSheet}
        role={session.role}
        trash={false}
        tags={[]}
        filters={{}}
        onFilters={() => {}}
        tagFilter={false}
        sortable={false}
        onOpen={() => {}}
        onDone={() => setSheet(null)}
        onTrashed={onTrashed}
        onUseFrame={hasPlayer && !version ? useFrame : undefined}
        previewing={version}
      />}
    </View>
  )
}
