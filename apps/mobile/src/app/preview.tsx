import type { Item, TextPlace, Version } from "@nimbus/shared/api"
import { router, useFocusEffect } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { isPictureInPictureSupported, type VideoPlayer, type VideoView } from "expo-video"
import { ArrowSquareOut, ChatCircle, DownloadSimple, DotsThreeVertical, MagnifyingGlass, NotePencil, PencilSimpleLine, PictureInPicture, ShareNetwork, X } from "phosphor-react-native"
import { useCallback, useEffect, useRef, useState } from "react"
import { BackHandler, FlatList, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native"
import Animated, { useAnimatedStyle, useReducedMotion, withTiming } from "react-native-reanimated"
import { useSafeAreaFrame, useSafeAreaInsets } from "react-native-safe-area-context"

import { Directory } from "expo-file-system"

import { CastBtn } from "@/components/cast-ui"
import { FindBar } from "@/components/find-bar"
import { FileSheets } from "@/components/file-sheets"
import { AudioPage, CollaboraView, ImagePage, NoPreview, WebPage, type Mark, type PageProps } from "@/components/preview-pages"
import { resetScreen, VideoPage } from "@/components/video-page"
import { useSnack } from "@/components/snackbar"
import { IconButton, Text } from "@/components/ui"
import { errorText } from "@/lib/api"
import { stopQueue } from "@/lib/audio-queue"
import { anchorTarget } from "@/lib/comment-anchor"
import { canEdit } from "@/lib/editor-rules"
import { canEditPhoto } from "@/lib/photo-edit-rules"
import { canEditPdf } from "@/lib/pdf-edit-rules"
import { editable, shareable, useApi, useDetails, useFileActions, useInstance, type FileSheet } from "@/lib/files"
import { planFor, type Plan } from "@/lib/preview-rules"
import { clearPreview, previewSession } from "@/lib/preview-session"
import { useTransfers } from "@/lib/transfers"
import { Secure, useVaultLock } from "@/components/vault-lock"
import { useVaultItem } from "@/components/vault-item"
import { vaultDirUri, vaultNative } from "@/lib/vault"
import { frameToWebp } from "@/lib/thumbs"
import { native } from "@/lib/native"
import { c } from "@/lib/theme"

const BAR = 56
const LOAD_MORE_WITHIN = 3
const COUNTS_AS_OPENED_MS = 800

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
  const videoView = useRef<VideoView | null>(null)
  const [hasPlayer, setHasPlayer] = useState(false)
  // Search in this file; and the box on an image where the words are.
  const [finding, setFinding] = useState(false)
  const [mark, setMark] = useState<Mark | null>(() => (session.start?.box ? { box: session.start.box, n: 0 } : null))
  const markN = useRef(0)

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
  // The admin's cap on editable PDFs; an older server or no connection falls back to the default.
  const instance = useInstance()
  const item: Item = (details.data?.item?.id === shown?.id ? details.data?.item : null) ?? shown
  const plan = shown ? planOf(item.name, version ? version.mime : item.mime, version?.size ?? item.size) : null
  const immersive = plan?.show === "image" || plan?.show === "video"
  const top = inset.top + BAR
  // Words were read out of images, videos and PDFs; a vault's files are never read.
  const canFind = !vaultId && !version && (plan?.show === "image" || plan?.show === "video" || (plan?.show === "web" && plan.viewer === "pdf"))

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
    setFinding(false)
    if (index !== session.index) setMark(null)
  }, [index, session.index])

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

  // A video's controls decide when the bar shows. Fullscreen hides the system bars too.
  const [videoFull, setVideoFull] = useState(false)
  const isVideo = plan?.show === "video"
  const fullscreen = isVideo && videoFull
  useEffect(() => native?.immersive?.(fullscreen), [fullscreen])
  // Off a video, the screen turns and lights as the phone says again.
  useEffect(() => {
    if (!isVideo) resetScreen()
  }, [isVideo])
  useEffect(() => resetScreen, [])

  const onTap = useCallback(() => setBars((b) => !b), [])
  const onScrollDown = useCallback((down: boolean) => setBars(!down), [])
  const onPlayer = useCallback((p: VideoPlayer | null, view?: VideoView | null) => {
    player.current = p
    videoView.current = view ?? null
    setHasPlayer(!!p)
  }, [])

  // Closing the previewer ends the audio queue; leaving the app keeps it playing.
  useEffect(() => stopQueue, [])

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
  // The nearest video before or after the shown file, for the player's previous and next.
  const videoAt = (by: 1 | -1) => {
    if (version) return -1
    for (let i = index + by; i >= 0 && i < items.length; i += by) {
      const it = items[i]
      if (planOf(it.name, it.mime, it.size).show === "video") return i
    }
    return -1
  }
  const prevVideo = isVideo ? videoAt(-1) : -1
  const nextVideo = isVideo ? videoAt(1) : -1
  const goVideo = useRef((by: 1 | -1) => {})
  goVideo.current = (by) => {
    const to = by < 0 ? prevVideo : nextVideo
    if (to < 0) return
    listRef.current?.scrollToIndex({ index: to, animated: false })
    goTo(to)
  }
  const videoNav = isVideo && (prevVideo >= 0 || nextVideo >= 0) ? { prev: prevVideo >= 0, next: nextVideo >= 0, go: (by: 1 | -1) => goVideo.current(by) } : undefined
  // Turning the phone changes the page width; the list stays mounted (so a video keeps playing) and moves back
  // to the same page once its pages have their new size.
  const indexRef = useRef(index)
  indexRef.current = index
  const realign = useCallback(() => listRef.current?.scrollToOffset({ offset: indexRef.current * width, animated: false }), [width])
  const latestEdge = useRef(onEdge)
  latestEdge.current = onEdge
  const edge = useCallback((by: number) => latestEdge.current(by), [])
  // The audio queue moved on to another track: show it.
  const onAudioTrack = useCallback(
    (next: Item) => {
      const to = items.findIndex((i) => i.id === next.id)
      if (to < 0) return
      listRef.current?.scrollToIndex({ index: to, animated: false })
      goTo(to)
    },
    [items]
  )

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

  const jump = (p: TextPlace) => {
    const to = anchorTarget(item.id)
    if (p.kind === "page" && p.page) to?.page?.(p.page)
    else if (p.kind === "time" && p.tMs != null) to?.seek?.(Math.max(0, p.tMs / 1000 - 2))
    else if (p.box) setMark({ box: p.box, n: ++markN.current })
  }

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
        if (finding) setFinding(false)
        else if (sheet) setSheet(null)
        else return false
        return true
      })
      return () => sub.remove()
    }, [sheet, finding])
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
          onBars={setBars}
          onFullscreen={setVideoFull}
          onPlayer={onPlayer}
          videoNav={i === index ? videoNav : undefined}
          onAudioTrack={onAudioTrack}
          start={i === session.index ? session.start : undefined}
          mark={i === index ? mark : null}
        />
      </View>
    ),
    [width, height, index, version, top, inset.bottom, edge, onTap, onScrollDown, onPlayer, onAudioTrack, videoNav?.prev, videoNav?.next, session.index, session.start, mark]
  )

  if (!shown) return <View style={{ flex: 1, backgroundColor: c.background }} />

  return (
    <View style={{ flex: 1, backgroundColor: immersive ? "#000" : c.background }} onTouchStartCapture={vaultId ? touch : undefined}>
      {vaultId && <Secure />}
      <StatusBar hidden={(immersive && !bars) || fullscreen} style="light" />
      <FlatList
        ref={listRef}
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
        onContentSizeChange={realign}
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
        {hasPlayer && plan?.show === "video" && isPictureInPictureSupported() && (
          <IconButton icon={PictureInPicture} label="Picture in picture" onPress={() => void videoView.current?.startPictureInPicture().catch(() => snack({ text: "Couldn't start picture in picture.", error: true }))} />
        )}
        {canFind && <IconButton icon={MagnifyingGlass} label="Find in this file" onPress={() => setFinding(true)} />}
        {!vaultId && !version && (plan?.show === "image" || plan?.show === "video" || plan?.show === "audio") && <CastBtn />}
        {!vaultId && !version && (
          <IconButton
            icon={ChatCircle}
            label={item.comments ? `Comments, ${item.comments} open` : "Comments"}
            onPress={() => router.push({ pathname: "/comments/[id]", params: { id: item.id, name: item.name } })}
          />
        )}
        {!vaultId && !version && shareable(item, session.role) && (
          <IconButton icon={ShareNetwork} label="Share" onPress={() => router.push({ pathname: "/share/[id]", params: { id: item.id, name: item.name } })} />
        )}
        {!vaultId && !version && editable([item], session.role) && canEdit(item.name, item.mime) && (
          <IconButton icon={NotePencil} label="Edit" onPress={() => router.push({ pathname: "/edit", params: { id: item.id } })} />
        )}
        {!vaultId && !version && editable([item], session.role) && canEditPhoto(item.mime) && (
          <IconButton icon={PencilSimpleLine} label="Edit photo" onPress={() => router.push({ pathname: "/photo-edit", params: { id: item.id } })} />
        )}
        {canEditPdf(item, { editable: editable([item], session.role), vault: !!vaultId, version: !!version, max: instance.data?.maxPdfEditBytes }) && (
          <IconButton icon={PencilSimpleLine} label="Edit PDF" onPress={() => router.push({ pathname: "/pdf-edit", params: { id: item.id } })} />
        )}
        {!vaultId && <IconButton icon={DownloadSimple} label="Download" onPress={() => download([item], version)} />}
        {!vaultId && <IconButton icon={DotsThreeVertical} label="More actions" onPress={() => setSheet({ kind: "actions", items: [item] })} />}
      </Animated.View>

      {finding && canFind && !fullscreen && (
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, height: top, paddingTop: inset.top, paddingHorizontal: 4, backgroundColor: immersive ? "#000" : c.background }}>
          <FindBar id={item.id} background={immersive ? "#000" : c.background} onJump={jump} onClose={() => setFinding(false)} />
        </View>
      )}

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
