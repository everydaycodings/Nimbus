// One page of the previewer, per kind of file. app/preview.tsx holds the pager and the bars.
import type { Item, OfficeResponse, PreviewResponse, Version } from "@nimbus/shared/api"
import { formatBytes, typeKeyOf } from "@nimbus/shared/file-rules"
import { useQuery } from "@tanstack/react-query"
import { useAudioPlayer, useAudioPlayerStatus, useAudioPlaylistStatus } from "expo-audio"
import { fetch as streamingFetch } from "expo/fetch"
import { Image } from "expo-image"
import { useNetworkState, NetworkStateType } from "expo-network"
import type { VideoPlayer, VideoView } from "expo-video"
import { ArrowClockwise, ArrowCounterClockwise, Moon, Pause, Play, SkipBack, SkipForward } from "phosphor-react-native"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ActivityIndicator, Linking, Pressable, ScrollView, View, useWindowDimensions, type GestureResponderEvent } from "react-native"
import { Gesture, GestureDetector } from "react-native-gesture-handler"
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated"
import { WebView, type WebViewMessageEvent } from "react-native-webview"

import { FileIcon } from "@/components/file-icon"
import { Button, IconButton, Text } from "@/components/ui"
import { errorText } from "@/lib/api"
import { CastBar, CastRemote, useCastItem } from "@/components/cast-ui"
import { CustomSleep, SleepRows, sleepDetail } from "@/components/sleep-menu"
import { Sheet } from "@/components/sheet"
import { answerResume, setSleep, startQueue, useAudioExtras, useQueue, type Queue } from "@/lib/audio-queue"
import { getSpeed, setSpeed, type Sleep } from "@/lib/playback"
import { cachedFile, fetchToCache, offlineFile } from "@/lib/file-cache"
import { registerAnchor } from "@/lib/comment-anchor"
import { useApi } from "@/lib/files"
import { previewSession } from "@/lib/preview-session"
import { decryptTemp, useVaultFile, vaultNative, vaultTemp } from "@/lib/vault"
import { useVaultItem } from "@/components/vault-item"
import { needsDataWarning, toBase64, type Plan, type Viewer } from "@/lib/preview-rules"
import { useTransfers } from "@/lib/transfers"
import { c, radius } from "@/lib/theme"
import { clock } from "@/lib/time"

export type PageProps = {
  item: Item
  version?: Version
  active: boolean
  // How far content must start below the top bar.
  top: number
  bottom: number
  onTap: () => void
  onScrollDown: (down: boolean) => void
  // True while the page wants sideways drags for itself, so the pager holds still.
  onZoom: (zoomed: boolean) => void
  onEdge: (by: number) => void
  // A video page shows and hides the top bar along with its own controls.
  onBars: (shown: boolean) => void
  onFullscreen: (on: boolean) => void
  // The view too, for picture-in-picture.
  onPlayer: (player: VideoPlayer | null, view?: VideoView | null) => void
  // On the shown video only: whether there's a video before or after it in the list, and a way there.
  videoNav?: { prev: boolean; next: boolean; go: (by: 1 | -1) => void }
  // The audio queue moved on to this track.
  onAudioTrack: (item: Item) => void
}

// Lazy, so a viewer's few MB of script aren't parsed until it's needed.
const VIEWER_HTML: Record<Viewer, () => string> = {
  pdf: () => require("@/lib/viewers/pdf").default,
  docx: () => require("@/lib/viewers/docx").default,
  sheet: () => require("@/lib/viewers/sheet").default,
  pptx: () => require("@/lib/viewers/pptx").default,
  text: () => require("@/lib/viewers/text").default,
  zip: () => require("@/lib/viewers/zip").default,
}

const sizeOf = (item: Item, version?: Version) => version?.size ?? item.size
const versionId = (item: Item, version?: Version) => version?.id ?? item.version

// Signed URLs last an hour, and a stale one is refetched on a load error.
export function usePreviewUrl(item: Item, version: Version | undefined, enabled: boolean, quality?: number) {
  const api = useApi()
  const vault = previewSession()?.vault
  const local = useVaultFile(vault, item, enabled)
  // A copy kept offline plays from the phone, with or without a connection.
  const kept = useMemo(() => {
    const f = version ? null : offlineFile(api.id, item.id, item.version)
    return f?.exists ? f.uri : undefined
  }, [api.id, item.id, item.version, version])
  const query = useQuery({
    queryKey: [api.id, "preview", item.id, version?.id, quality],
    enabled: enabled && !kept && !vault,
    staleTime: 50 * 60_000,
    queryFn: () => api.get<PreviewResponse>(`/items/${item.id}/preview${version ? `?v=${version.id}` : quality ? `?quality=${quality}` : ""}`),
  })
  if (vault) return { ...local, copies: undefined }
  return { url: kept ?? query.data?.url, copies: query.data?.copies, error: kept ? null : query.error, refetch: query.refetch }
}

// ---- When there's nothing to show, or it failed: always a way forward ----

export function NoPreview({ item, version, reason, onRetry }: { item: Item; version?: Version; reason: string; onRetry?: () => void }) {
  const { download, openWith } = useTransfers()
  const vault = useVaultItem(previewSession()?.vault)
  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 8 }}>
      <FileIcon item={item} size={56} />
      <Text variant="titleSmall" numberOfLines={2} style={{ textAlign: "center", marginTop: 8 }}>
        {item.name}
      </Text>
      <Text variant="bodySmall" color={c.mutedForeground} style={{ fontVariant: ["tabular-nums"] }}>
        {formatBytes(sizeOf(item, version))}
      </Text>
      <Text variant="bodySmall" color={c.mutedForeground} accessibilityLiveRegion="polite" style={{ textAlign: "center", marginTop: 8, maxWidth: 320 }}>
        {reason}
      </Text>
      <View style={{ gap: 8, marginTop: 16, alignSelf: "stretch", maxWidth: 320, width: "100%", alignItems: "stretch", marginHorizontal: "auto" }}>
        {onRetry && <Button label="Try again" onPress={onRetry} />}
        <Button variant={onRetry ? "outlined" : "filled"} label="Open with" onPress={() => (vault ? vault.openWith(item) : openWith(item, version))} />
        <Button variant="outlined" label="Download" onPress={() => (vault ? vault.download(item) : download([item], version))} />
      </View>
      {vault?.dialog}
    </ScrollView>
  )
}

export const Loading = ({ progress }: { progress?: number }) => (
  <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}>
    <ActivityIndicator color={c.mutedForeground} accessibilityLabel="Loading" />
    {progress !== undefined && (
      <View style={{ width: 160, height: 2, backgroundColor: c.mutedStrong, borderRadius: 1 }}>
        <View style={{ height: 2, width: `${Math.round(progress * 100)}%`, backgroundColor: c.brand, borderRadius: 1 }} />
      </View>
    )}
  </View>
)

// ---- Image ----

const TAP_SLOP = 12

export function ImagePage({ item, version, active, near, bottom, onTap, onZoom }: PageProps & { near: boolean }) {
  const { account } = useApi()
  // The TV follows the swipes.
  const cast = useCastItem({ item, kind: "image", active: active && !version && !previewSession()?.vault })
  const { url, error, refetch } = usePreviewUrl(item, version, near)
  const { width: W, height: H } = useWindowDimensions()
  const [failed, setFailed] = useState(false)
  const retried = useRef(false)

  const scale = useSharedValue(1)
  const start = useSharedValue(1)
  const x = useSharedValue(0)
  const y = useSharedValue(0)
  const sx = useSharedValue(0)
  const sy = useSharedValue(0)

  const reset = useCallback(() => {
    scale.value = withTiming(1, { duration: 180 })
    x.value = withTiming(0, { duration: 180 })
    y.value = withTiming(0, { duration: 180 })
    onZoom(false)
  }, [scale, x, y, onZoom])

  // Swiped away: come back to it unzoomed.
  useEffect(() => {
    if (!active) {
      scale.value = 1
      x.value = 0
      y.value = 0
    }
  }, [active, scale, x, y])

  const clamp = (v: number, max: number) => {
    "worklet"
    return Math.min(max, Math.max(-max, v))
  }
  const pinch = Gesture.Pinch()
    .onStart(() => {
      start.value = scale.value
    })
    .onUpdate((e) => {
      scale.value = Math.min(6, Math.max(1, start.value * e.scale))
    })
    .onEnd(() => {
      runOnJS(onZoom)(scale.value > 1.02)
      if (scale.value <= 1.02) {
        x.value = withTiming(0)
        y.value = withTiming(0)
      }
    })
  // Only claims the finger while zoomed, so an unzoomed swipe still changes file.
  const pan = Gesture.Pan()
    .manualActivation(true)
    .onTouchesMove((_, state) => {
      if (scale.value > 1.02) state.activate()
      else state.fail()
    })
    .onStart(() => {
      sx.value = x.value
      sy.value = y.value
    })
    .onUpdate((e) => {
      x.value = clamp(sx.value + e.translationX, ((scale.value - 1) * W) / 2)
      y.value = clamp(sy.value + e.translationY, ((scale.value - 1) * H) / 2)
    })
  const zoomTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDistance(TAP_SLOP)
    .onEnd(() => {
      if (scale.value > 1.02) runOnJS(reset)()
      else {
        scale.value = withTiming(2.5, { duration: 180 })
        runOnJS(onZoom)(true)
      }
    })
  const tap = Gesture.Tap().maxDistance(TAP_SLOP).onEnd(() => runOnJS(onTap)())
  const gesture = Gesture.Simultaneous(pinch, pan, Gesture.Exclusive(zoomTap, tap))
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }] }))

  if (failed || (error && !url))
    return <NoPreview item={item} version={version} reason="Couldn't show this image." onRetry={() => { retried.current = false; setFailed(false); refetch() }} />

  return (
    <>
    <GestureDetector gesture={gesture}>
      <Animated.View collapsable={false} style={[{ flex: 1 }, style]} accessible accessibilityRole="image" accessibilityLabel={item.name}>
        <Image
          source={url ? { uri: url, cacheKey: `${item.id}-${versionId(item, version)}` } : undefined}
          placeholder={
            item.thumb && !version
              ? { uri: `${account.server}/api/files/${item.id}/thumb?v=${item.version}&r=${item.thumb}`, headers: { authorization: `Bearer ${account.token}` } }
              : undefined
          }
          placeholderContentFit="contain"
          contentFit="contain"
          cachePolicy="disk"
          transition={0}
          style={{ flex: 1 }}
          onError={() => {
            // Once for a URL that went stale, then it's the file.
            if (retried.current) return setFailed(true)
            retried.current = true
            refetch()
          }}
          accessibilityIgnoresInvertColors
        />
      </Animated.View>
    </GestureDetector>
    {cast.casting && <CastBar bottom={bottom + 24} />}
    </>
  )
}

// ---- Audio ----

const SPEEDS = [1, 1.25, 1.5, 2, 0.75]

export { clock }

type AudioViewProps = {
  item: Item
  version?: Version
  top: number
  position: number
  duration: number
  playing: boolean
  onSeek: (seconds: number) => void
  onToggle: () => void
  onSpeed: (rate: number) => void
  // Next and previous track, when there is a queue.
  onSkip?: (by: 1 | -1) => void
  // The sleep timer, and a long track waiting for the choice of where to start (the queue only).
  sleep?: { value: Sleep; onChange: (s: Sleep) => void }
  resume?: { at: number; answer: (resume: boolean) => void }
}

// The controls, for whichever player is behind them.
function AudioView({ item, version, top, position: playedTo, duration, playing, onSeek, onToggle, onSpeed, onSkip, sleep, resume }: AudioViewProps) {
  const { account } = useApi()
  const [speed, setRate] = useState(getSpeed("audio"))
  const [sleepSheet, setSleepSheet] = useState(false)
  const [custom, setCustom] = useState(false)
  const [barWidth, setBarWidth] = useState(1)
  const [drag, setDrag] = useState<number | null>(null)

  const position = drag ?? playedTo
  const fraction = duration ? Math.min(1, position / duration) : 0
  const seekFrom = (e: GestureResponderEvent) => Math.max(0, Math.min(1, e.nativeEvent.locationX / barWidth)) * duration
  const jump = (by: number) => onSeek(Math.max(0, Math.min(duration, position + by)))

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingTop: top, paddingHorizontal: 32, gap: 24 }}>
      <View style={{ width: 240, height: 240, maxWidth: "100%", borderRadius: radius.card, backgroundColor: c.card, alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
        {item.thumb && !version ? (
          <Image
            source={{ uri: `${account.server}/api/files/${item.id}/thumb?v=${item.version}&r=${item.thumb}`, headers: { authorization: `Bearer ${account.token}` } }}
            style={{ width: "100%", height: "100%" }}
            contentFit="cover"
            accessibilityIgnoresInvertColors
          />
        ) : (
          <FileIcon item={item} size={72} />
        )}
      </View>
      <View style={{ width: "100%", maxWidth: 480, gap: 4 }}>
        <View
          onLayout={(e) => setBarWidth(e.nativeEvent.layout.width || 1)}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderTerminationRequest={() => false}
          onResponderGrant={(e) => setDrag(seekFrom(e))}
          onResponderMove={(e) => setDrag(seekFrom(e))}
          onResponderRelease={(e) => {
            onSeek(seekFrom(e))
            setDrag(null)
          }}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Position"
          accessibilityValue={{ text: `${clock(position)} of ${clock(duration)}` }}
          style={{ height: 48, justifyContent: "center" }}
        >
          <View style={{ height: 4, borderRadius: 2, backgroundColor: c.mutedStrong }} pointerEvents="none">
            <View style={{ height: 4, borderRadius: 2, width: `${fraction * 100}%`, backgroundColor: c.foreground }} />
          </View>
          <View pointerEvents="none" style={{ position: "absolute", left: `${fraction * 100}%`, marginLeft: -7, width: 14, height: 14, borderRadius: 7, backgroundColor: c.foreground }} />
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text variant="caption" color={c.mutedForeground} style={{ fontVariant: ["tabular-nums"] }}>{clock(position)}</Text>
          <Text variant="caption" color={c.mutedForeground} style={{ fontVariant: ["tabular-nums"] }}>{clock(duration)}</Text>
        </View>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
        <View style={{ width: 56 }} />
        <IconButton icon={ArrowCounterClockwise} label="Back 10 seconds" onPress={() => jump(-10)} />
        <View style={{ borderRadius: 32, overflow: "hidden" }}>
          <Pressable
            onPress={onToggle}
            android_ripple={{ color: "rgba(0,0,0,0.12)" }}
            accessibilityRole="button"
            accessibilityLabel={playing ? "Pause" : "Play"}
            style={{ width: 64, height: 64, alignItems: "center", justifyContent: "center", backgroundColor: c.primary }}
          >
            {playing ? <Pause size={28} weight="fill" color={c.primaryForeground} /> : <Play size={28} weight="fill" color={c.primaryForeground} />}
          </Pressable>
        </View>
        <IconButton icon={ArrowClockwise} label="Forward 10 seconds" onPress={() => jump(10)} />
        <Pressable
          onPress={() => {
            const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]
            setRate(next)
            setSpeed("audio", next)
            onSpeed(next)
          }}
          accessibilityRole="button"
          accessibilityLabel={`Playback speed ${speed} times`}
          style={{ width: 56, height: 48, alignItems: "center", justifyContent: "center" }}
        >
          <Text variant="label" style={{ fontVariant: ["tabular-nums"] }}>{speed}×</Text>
        </Pressable>
      </View>
      {(onSkip || sleep) && (
        <View style={{ flexDirection: "row", gap: 32 }}>
          {onSkip && <IconButton icon={SkipBack} label="Previous track" onPress={() => onSkip(-1)} />}
          {sleep && <IconButton icon={Moon} label={`Sleep timer, ${sleepDetail(sleep.value, "End of track")}`} color={sleep.value === null ? c.foreground : c.brand} onPress={() => setSleepSheet(true)} />}
          {onSkip && <IconButton icon={SkipForward} label="Next track" onPress={() => onSkip(1)} />}
        </View>
      )}
      {resume && (
        <View style={{ flexDirection: "row", alignItems: "center", paddingLeft: 4, borderRadius: 24, backgroundColor: c.card, borderWidth: 1, borderColor: c.border }}>
          <Pressable onPress={() => resume.answer(true)} accessibilityRole="button" style={{ height: 44, paddingHorizontal: 12, justifyContent: "center" }}>
            <Text variant="label" color={c.brand} style={{ fontVariant: ["tabular-nums"] }}>Resume from {clock(resume.at)}</Text>
          </Pressable>
          <Pressable onPress={() => resume.answer(false)} accessibilityRole="button" style={{ height: 44, paddingHorizontal: 12, justifyContent: "center" }}>
            <Text variant="label" color={c.brand}>Start over</Text>
          </Pressable>
        </View>
      )}
      {sleep && sleepSheet && (
        <Sheet onClose={() => setSleepSheet(false)} header={<Text variant="titleSmall" style={{ paddingHorizontal: 20, paddingBottom: 8 }}>Sleep timer</Text>}>
          <SleepRows sleep={sleep.value} endLabel="End of track" onSleep={sleep.onChange} onCustom={() => setCustom(true)} />
        </Sheet>
      )}
      {sleep && custom && <CustomSleep onSet={(m) => sleep.onChange(Date.now() + m * 60_000)} onClose={() => setCustom(false)} />}
    </View>
  )
}

// Older versions and Vault files: one player on this page, which stops when you swipe away.
function LocalAudioPage({ item, version, active, top }: PageProps) {
  const { url, error, refetch } = usePreviewUrl(item, version, active)
  const player = useAudioPlayer(url && active ? { uri: url } : null, { updateInterval: 250 })
  const status = useAudioPlayerStatus(player)
  const started = useRef<string | null>(null)

  useEffect(() => {
    if (!url || !active || started.current === url || !status.isLoaded) return
    started.current = url
    player.setPlaybackRate(getSpeed("audio"))
    player.play()
  }, [url, active, status.isLoaded, player])
  useEffect(() => {
    if (active) return
    started.current = null // Swiping back starts it again.
    if (status.playing) player.pause()
  }, [active, status.playing, player])

  useEffect(() => {
    if (!active) return
    return registerAnchor({
      id: item.id,
      time: () => player.currentTime,
      seek: (s) => {
        player.seekTo(s)
        player.play()
      },
    })
  }, [active, item.id, player])

  if (error && !url) return <NoPreview item={item} version={version} reason="Couldn't play this file." onRetry={() => refetch()} />

  return (
    <AudioView
      item={item}
      version={version}
      top={top}
      position={status.currentTime ?? 0}
      duration={status.duration || 0}
      playing={status.playing}
      onSeek={(s) => player.seekTo(s)}
      onToggle={() => (status.playing ? player.pause() : player.play())}
      onSpeed={(r) => player.setPlaybackRate(r)}
    />
  )
}

// The folder's audio plays as a queue (lib/audio-queue.ts). This page starts it when it comes on
// screen and shows whichever track is playing; the previewer follows the track when it moves on.
function QueueAudioPage({ item, active, top, onAudioTrack }: PageProps) {
  const api = useApi()
  const queue = useQueue()
  const live = queue?.account === api.id && queue.items.some((i) => i.id === item.id) ? queue : null
  // The TV plays it: the queue holds still here, and takes the TV's place when casting ends.
  const cast = useCastItem({
    item,
    kind: "audio",
    active,
    time: () => (live ? live.playlist.currentTime : 0),
    duration: () => (live ? live.playlist.duration : 0),
    onTaken: () => live?.playlist.pause(),
    onEnded: (at) => void live?.playlist.seekTo(at),
  })
  const [error, setError] = useState<string | null>(null)
  const starting = useRef(false)
  const mine = queue?.account === api.id && queue.items.some((i) => i.id === item.id)

  useEffect(() => {
    if (!active) return
    if (mine) {
      // Swiped to another track of the same queue.
      if (queue.items[queue.playlist.currentIndex]?.id !== item.id) queue.playlist.skipTo(queue.items.findIndex((i) => i.id === item.id))
      return
    }
    if (starting.current) return
    starting.current = true
    const files = (previewSession()?.items ?? [item]).filter((i) => i.kind === "file" && typeKeyOf("file", i.mime, i.name) === "audio")
    startQueue(api, files, Math.max(0, files.findIndex((i) => i.id === item.id)))
      .catch((e) => setError(errorText(e)))
      .finally(() => (starting.current = false))
  }, [active, mine, queue, item, api])

  // The playlist moved on by itself (or from the lock screen): bring this screen to that track.
  useEffect(() => {
    if (!active || !mine) return
    const sub = queue.playlist.addListener("trackChanged", (e) => {
      const next = queue.items[e.currentIndex]
      if (next && next.id !== item.id) onAudioTrack(next)
    })
    return () => sub.remove()
  }, [active, mine, queue, item.id, onAudioTrack])

  if (error) return <NoPreview item={item} reason={error} onRetry={() => setError(null)} />
  if (!mine) return <Loading />
  return (
    <>
      <QueueControls queue={queue} item={item} top={top} />
      {cast.casting && <CastRemote item={item} kind="audio" top={top} nav={{ prev: queue.playlist.currentIndex > 0, next: queue.playlist.currentIndex < queue.items.length - 1, go: (by) => (by > 0 ? queue.playlist.next() : queue.playlist.previous()) }} />}
      {cast.sheet}
    </>
  )
}

function QueueControls({ queue, item, top }: { queue: Queue; item: Item; top: number }) {
  const status = useAudioPlaylistStatus(queue.playlist)
  const extras = useAudioExtras()
  const at = useRef(0)
  at.current = status.currentTime ?? 0
  useEffect(
    () =>
      registerAnchor({
        id: item.id,
        time: () => at.current,
        seek: (s) => {
          void queue.playlist.seekTo(s)
          queue.playlist.play()
        },
      }),
    [item.id, queue]
  )
  return (
    <AudioView
      item={item}
      top={top}
      position={status.currentTime ?? 0}
      duration={status.duration || 0}
      playing={status.playing}
      onSeek={(s) => void queue.playlist.seekTo(s)}
      onToggle={() => (status.playing ? queue.playlist.pause() : queue.playlist.play())}
      onSpeed={(r) => (queue.playlist.playbackRate = r)}
      onSkip={(by) => (by > 0 ? queue.playlist.next() : queue.playlist.previous())}
      sleep={{ value: extras.sleep, onChange: setSleep }}
      resume={extras.resume?.id === item.id ? { at: extras.resume.at, answer: answerResume } : undefined}
    />
  )
}

export function AudioPage(props: PageProps) {
  return props.version || previewSession()?.vault ? <LocalAudioPage {...props} /> : <QueueAudioPage {...props} />
}

// ---- Documents: a sandboxed page, with this side reading the bytes ----

const MB = 1024 ** 2
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")

export function WebPage({ item, version, plan, active, top, bottom, onScrollDown, onZoom, onEdge }: PageProps & { plan: Extract<Plan, { show: "web" }> }) {
  const api = useApi()
  const net = useNetworkState()
  const web = useRef<WebView>(null)
  const size = sizeOf(item, version)
  const ver = versionId(item, version)
  const [allowed, setAllowed] = useState(false)
  const [progress, setProgress] = useState(0)
  const [ready, setReady] = useState(false)
  const [drawn, setDrawn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  const vault = previewSession()?.vault
  const vn = vault ? vaultNative : null
  // A vault file is decrypted to a temp copy first; the viewer then reads that like any cached file.
  const localFile = () => (vault && vn ? vaultTemp(vn, api, vault, item) : cachedFile(api.id, item.id, ver))
  const cached = plan.fetch === "cache" && localFile().exists
  const warn = needsDataWarning(plan, net.type === NetworkStateType.CELLULAR, cached) && !allowed

  // A comment's "Page n" chip scrolls the PDF there.
  useEffect(() => {
    if (!active || plan.viewer !== "pdf") return
    return registerAnchor({
      id: item.id,
      page: (n) =>
        web.current?.injectJavaScript(
          `(function(){var p=document.querySelector('.page[data-n="${Math.floor(n)}"]');if(p)p.scrollIntoView()})();true;`
        ),
    })
  }, [active, plan.viewer, item.id])

  const url = useCallback(
    async () => (await api.get<PreviewResponse>(`/items/${item.id}/preview${version ? `?v=${version.id}` : ""}`)).url,
    [api, item.id, version]
  )

  // Fetches the whole file first when that's the plan. Swiping away cancels it.
  useEffect(() => {
    if (!active || warn || ready || plan.fetch !== "cache") return
    if (vault && vn) {
      let live = true
      decryptTemp(api, vn, vault, item, (d, t) => live && setProgress(t ? d / t : 0)).then(
        () => live && setReady(true),
        (e) => live && setError(errorText(e))
      )
      return () => {
        live = false
      }
    }
    const stop = new AbortController()
    fetchToCache(api.id, item.id, ver, url, { signal: stop.signal, onProgress: (b, t) => setProgress(t ? b / t : 0) }).then(
      () => setReady(true),
      (e) => {
        if (!stop.signal.aborted) setError(`${errorText(e)}`)
      }
    )
    return () => stop.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `attempt` retries; the rest name the file
  }, [active, warn, attempt, plan.fetch, api.id, item.id, ver])
  useEffect(() => {
    if (active && !warn && plan.fetch === "range") setReady(true)
  }, [active, warn, plan.fetch])

  // Local reads run synchronously so concurrent requests can't move each other's offset.
  const handle = useRef<ReturnType<ReturnType<typeof cachedFile>["open"]> | null>(null)
  const signed = useRef<string | null>(null)
  useEffect(
    () => () => {
      handle.current?.close()
      handle.current = null
    },
    []
  )

  const readRange = useCallback(
    async (offset: number, length: number, fresh = false): Promise<Uint8Array> => {
      if (fresh || !signed.current) signed.current = await url()
      const r = await streamingFetch(signed.current, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } })
      // A signed URL can expire while a long PDF is open.
      if (r.status === 403 && !fresh) return readRange(offset, length, true)
      if (!r.ok) throw new Error(`The server answered ${r.status}.`)
      const bytes = new Uint8Array(await r.arrayBuffer())
      return r.status === 206 ? bytes : bytes.subarray(offset, offset + length)
    },
    [url]
  )

  const readBytes = useCallback(
    (offset: number, length: number) => {
      if (plan.fetch === "range") return readRange(offset, length)
      handle.current ??= localFile().open()
      handle.current.offset = offset
      return Promise.resolve(handle.current.readBytesSync(length))
    },
    [plan.fetch, readRange, api.id, item.id, ver]
  )

  // Coming back to this page: the pager has to step aside again if it's wide.
  const overflow = useRef(false)
  const isActive = useRef(active)
  isActive.current = active
  useEffect(() => {
    if (active) onZoom(overflow.current)
  }, [active, onZoom])

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      let m: { t: string; id?: number; offset?: number; length?: number; down?: boolean; url?: string; message?: string; detail?: string; on?: boolean; by?: number }
      try {
        m = JSON.parse(e.nativeEvent.data)
      } catch {
        return
      }
      if (m.t === "read")
        readBytes(m.offset!, m.length!).then(
          (bytes) => web.current?.injectJavaScript(`__reply(${m.id},"${toBase64(bytes)}");true;`),
          () => web.current?.injectJavaScript(`__reply(${m.id},null);true;`)
        )
      else if (m.t === "ready") setDrawn(true)
      else if (m.t === "scroll") onScrollDown(!!m.down)
      else if (m.t === "overflow") {
        overflow.current = !!m.on
        if (isActive.current) onZoom(!!m.on)
      } else if (m.t === "edge") onEdge(m.by!)
      else if (m.t === "link" && /^(https?:|mailto:)/i.test(m.url ?? "")) Linking.openURL(m.url!).catch(() => {})
      else if (m.t === "error") {
        if (__DEV__) console.warn("viewer:", m.detail)
        setError(m.message ?? "Couldn't open this file.")
      }
    },
    [readBytes, onScrollDown, onZoom, onEdge]
  )

  // In the markup rather than injected: an injected script can lose the race with the page's own.
  const source = useMemo(() => {
    if (!ready) return null
    const meta = `<head><meta name="nimbus" content="${esc(JSON.stringify({ name: item.name, size, top, bottom }))}">`
    return { html: VIEWER_HTML[plan.viewer]().replace("<head>", () => meta), baseUrl: "about:blank" }
  }, [ready, plan.viewer, item.name, size, top, bottom])

  if (error)
    return (
      <NoPreview
        item={item}
        version={version}
        reason={error}
        onRetry={() => {
          setError(null)
          setReady(false)
          setDrawn(false)
          setProgress(0)
          setAttempt((n) => n + 1)
          if (plan.fetch === "range") setReady(true)
        }}
      />
    )
  if (warn)
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 8 }}>
        <FileIcon item={item} size={56} />
        <Text variant="titleSmall" numberOfLines={2} style={{ textAlign: "center", marginTop: 8 }}>{item.name}</Text>
        <Text variant="bodySmall" color={c.mutedForeground} style={{ textAlign: "center", marginTop: 8, maxWidth: 320 }}>
          You're on mobile data. This will use {Math.round(plan.bytes / MB)} MB.
        </Text>
        <View style={{ marginTop: 16 }}>
          <Button label="Load anyway" onPress={() => setAllowed(true)} />
        </View>
      </View>
    )
  if (!source) return <View style={{ flex: 1, paddingTop: top }}>{active ? <Loading progress={plan.fetch === "cache" ? progress : undefined} /> : null}</View>

  return (
    <View style={{ flex: 1 }}>
    <WebView
      ref={web as never}
      key={attempt}
      source={source}
      originWhitelist={["*"]}
      onMessage={onMessage}
      // These pages never go anywhere: links are handed to the phone through onMessage.
      onShouldStartLoadWithRequest={(r) => r.url === "about:blank" || r.url.startsWith("data:") || r.url.startsWith("blob:")}
      onError={() => setError("Couldn't open this file.")}
      onRenderProcessGone={() => setError("This phone ran out of memory opening this file.")}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      domStorageEnabled={false}
      thirdPartyCookiesEnabled={false}
      cacheEnabled={false}
      incognito
      mixedContentMode="never"
      setBuiltInZoomControls
      setDisplayZoomControls={false}
      overScrollMode="never"
      textZoom={100}
      webviewDebuggingEnabled={__DEV__}
      style={{ flex: 1, backgroundColor: c.background }}
    />
    {!drawn && (
      <View pointerEvents="none" style={{ position: "absolute", top, left: 0, right: 0, bottom: 0, backgroundColor: c.background }}>
        <Loading />
      </View>
    )}
    </View>
  )
}

// ---- Collabora: the server's own viewer, signed for this file ----

export function useOffice(item: Item | null, version?: Version) {
  const api = useApi()
  return useQuery({
    queryKey: [api.id, "office", item?.id, version?.id],
    enabled: !!item,
    // The token inside is short-lived and one screen's worth of use.
    gcTime: 0,
    queryFn: () => api.get<OfficeResponse>(`/items/${item!.id}/office${version ? `?v=${version.id}` : ""}`),
  })
}

export function CollaboraView({ item, version, top, active }: { item: Item; version?: Version; top: number; active: boolean }) {
  const office = useOffice(active ? item : null, version)
  const [failed, setFailed] = useState(false)
  if (!active) return null
  if (office.isPending) return <Loading />
  if (office.isError || failed)
    return <NoPreview item={item} version={version} reason="Couldn't reach the document viewer on this server." onRetry={() => { setFailed(false); office.refetch() }} />
  const o = office.data?.office
  if (!o) return <NoPreview item={item} version={version} reason="This server doesn't have a viewer for this type of file." />
  return (
    <View style={{ flex: 1, paddingTop: top }}>
      <WebView
        originWhitelist={["*"]}
        source={{
          html: `<!doctype html><body style="background:${c.background}"><form id="f" method="post" action="${esc(o.action)}"><input type="hidden" name="access_token" value="${esc(o.token)}"><input type="hidden" name="access_token_ttl" value="0"></form><script>document.getElementById("f").submit()</script></body>`,
          baseUrl: "about:blank",
        }}
        onError={() => setFailed(true)}
        onHttpError={() => setFailed(true)}
        // Collabora's own close ("<") leaves a blank page here; the header's close does that job. Its CSP blocks a
        // <style>, so hide the buttons from script, again whenever Collabora rebuilds its toolbar.
        injectedJavaScript={`(function(){function h(){["toolbar-mobile-back","closebuttonwrapper"].forEach(function(id){var e=document.getElementById(id);if(e&&e.style.display!=="none")e.style.setProperty("display","none","important")})}h();new MutationObserver(h).observe(document.documentElement,{childList:true,subtree:true})})();true;`}
        allowFileAccess={false}
        incognito
        nestedScrollEnabled
        startInLoadingState
        renderLoading={() => <View style={{ position: "absolute", inset: 0, backgroundColor: c.background }}><Loading /></View>}
        style={{ flex: 1, backgroundColor: c.background }}
      />
    </View>
  )
}
