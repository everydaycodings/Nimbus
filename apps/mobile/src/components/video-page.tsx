// The previewer's video page: our own controls over expo-video, with gestures, rotation,
// tracks, resume and next/previous. app/preview.tsx holds the pager and the top bar.
import type { SubtitleTrack, SubtitlesResponse } from "@nimbus/shared/api"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Image } from "expo-image"
import { VideoView, useVideoPlayer, type VideoContentFit, type VideoPlayer, type VideoThumbnail } from "expo-video"
import {
  ArrowsIn,
  ArrowsOut,
  CaretLeft,
  Check,
  DeviceRotate,
  FastForward,
  GearSix,
  Lock,
  LockOpen,
  MagnifyingGlassPlus,
  Pause,
  Play,
  Rewind,
  SkipBack,
  SkipForward,
  SpeakerHigh,
  SpeakerX,
  Sun,
} from "phosphor-react-native"
import { useCallback, useEffect, useRef, useState, type ComponentType } from "react"
import { ActivityIndicator, BackHandler, Pressable, View, useWindowDimensions, type GestureResponderEvent } from "react-native"
import { Gesture, GestureDetector } from "react-native-gesture-handler"
import Animated, { useAnimatedStyle, useReducedMotion, withTiming } from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { CastRemote, useCastItem } from "@/components/cast-ui"
import { clock, Loading, NoPreview, usePreviewUrl, type PageProps } from "@/components/preview-pages"
import { Sheet, SheetDivider, SheetRow } from "@/components/sheet"
import { CustomSleep, SleepRows, sleepDetail } from "@/components/sleep-menu"
import { useSnack } from "@/components/snackbar"
import { IconButton, Text } from "@/components/ui"
import { cueAt, parseVtt } from "@/lib/captions"
import { registerAnchor } from "@/lib/comment-anchor"
import { useApi } from "@/lib/files"
import { onMobileData } from "@/lib/connectivity"
import { errorText } from "@/lib/api"
import { native } from "@/lib/native"
import { getMobileQuality, getPlayback, getPosition, getSpeed, makeCopy, putPosition, runSleep, setSpeed, type Sleep } from "@/lib/playback"
import { offerResume, pickQuality, qualityLabel, type Quality } from "@/lib/playback-rules"
import { previewSession } from "@/lib/preview-session"
import { c, radius } from "@/lib/theme"

const HIDE_MS = 3000
const SKIP = 10
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3]
const FITS: { fit: VideoContentFit; label: string }[] = [
  { fit: "contain", label: "Fit" },
  { fit: "cover", label: "Fill (crop)" },
  { fit: "fill", label: "Stretch" },
]
const UP_NEXT_S = 5
// Keeps a swipe that starts on the system bars from changing brightness or volume.
const EDGE = 32

type Icon = ComponentType<{ size?: number; color?: string; weight?: "regular" | "bold" | "fill" }>
type Hud = { icon: Icon; text?: string; level?: number }
type Menu = "main" | "speed" | "subs" | "audio" | "fit" | "sleep" | "quality"

// Rotation, system bars and brightness carry from one video to the next, so moving
// between videos doesn't flip the screen. The previewer resets them when it leaves video.
const screen = { rotationLocked: false }
export function resetScreen() {
  screen.rotationLocked = false
  native?.orient?.("auto", false)
  native?.immersive?.(false)
  native?.setBrightness?.(-1)
}

// A search match opens this many seconds early, so the words arrive on screen.
const SEARCH_LEAD_S = 2

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v))
const fmtRate = (r: number) => `${r}×`

export function VideoPage(props: PageProps) {
  const { item, version, active } = props
  const vault = !!previewSession()?.vault
  const base = usePreviewUrl(item, version, active)
  // Wi-Fi plays the original; mobile data plays the person's default copy. A choice in the settings wins.
  const [mobile, setMobile] = useState<boolean | null>(null)
  const [choice, setChoice] = useState<Quality | null>(null)
  const startAt = useRef<number | null>(null)
  useEffect(() => void onMobileData().then(setMobile), [])
  const copies = base.copies ?? []
  const quality: Quality | null = version || vault ? "original" : choice ?? (mobile === null ? null : pickQuality(mobile, getMobileQuality(), copies))
  const copy = usePreviewUrl(item, version, active && typeof quality === "number", typeof quality === "number" ? quality : undefined)
  const src = quality === "original" ? base : typeof quality === "number" ? copy : null
  const [failed, setFailed] = useState(false)
  const retried = useRef(false)
  const refetch = src?.refetch
  const onError = useCallback(() => {
    if (retried.current) return setFailed(true)
    retried.current = true
    refetch?.()
  }, [refetch])
  // A copy that can't be fetched falls back to the original.
  useEffect(() => {
    if (typeof quality === "number" && copy.error && !copy.url) setChoice("original")
  }, [quality, copy.error, copy.url])

  if (failed || (base.error && !base.url))
    return <NoPreview item={item} version={version} reason="Couldn't play this video." onRetry={() => { retried.current = false; setFailed(false); base.refetch() }} />
  if (!active || !src?.url || quality === null) return <Loading />
  return (
    <Player
      key={quality}
      {...props}
      url={src.url}
      onError={onError}
      quality={quality}
      copies={copies}
      startAt={startAt.current}
      onQuality={(q, at) => {
        startAt.current = at
        setChoice(q)
      }}
    />
  )
}

type PlayerProps = PageProps & { url: string; onError: () => void; quality: Quality; copies: number[]; startAt: number | null; onQuality: (q: Quality, at: number) => void }

function Player({ start, item, version, url, top, bottom, onBars, onZoom, onFullscreen, onPlayer, videoNav, onError, quality, copies, startAt, onQuality }: PlayerProps) {
  const api = useApi()
  const snack = useSnack()
  const queries = useQueryClient()
  const vault = !!previewSession()?.vault
  const still = useReducedMotion()
  const { width, height } = useWindowDimensions()
  const inset = useSafeAreaInsets()
  const view = useRef<VideoView>(null)

  // A vault file's name stays off the lock screen, and it stops when the app goes away (the vault locks anyway).
  const player = useVideoPlayer(vault ? { uri: url } : { uri: url, metadata: { title: item.name } }, (p) => {
    p.timeUpdateEventInterval = 0.25
    p.staysActiveInBackground = !vault
    p.showNowPlayingNotification = !vault
  })

  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(true)
  const [time, setTime] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [duration, setDuration] = useState(0)
  const [shown, setShown] = useState(true)
  const [locked, setLocked] = useState(false)
  const [lockHint, setLockHint] = useState(false)
  const [rotLocked, setRotLocked] = useState(screen.rotationLocked)
  const [tallFull, setTallFull] = useState(false)
  // From a decoded frame, which has the phone's rotation applied; the track's own size doesn't.
  const [wide, setWide] = useState<boolean | null>(null)
  const [fit, setFit] = useState<VideoContentFit>("contain")
  const [rate, setRate] = useState(getSpeed("video"))
  const [loop, setLoop] = useState(false)
  const [sleep, setSleep] = useState<Sleep>(null)
  const [customSleep, setCustomSleep] = useState(false)
  const [hud, setHud] = useState<Hud | null>(null)
  const [tapSeek, setTapSeek] = useState<{ side: 1 | -1; total: number } | null>(null)
  const [scrub, setScrub] = useState<number | null>(null)
  const [thumb, setThumb] = useState<VideoThumbnail | null>(null)
  // A long video left in the middle waits here for "Resume from…" or "Start over".
  const [resume, setResume] = useState<number | null>(null)
  const [upNext, setUpNext] = useState<number | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [pip, setPip] = useState(false)
  // Subtitle files beside the video and the auto transcript. expo-video only plays the tracks inside the file, so these are drawn here.
  const [ext, setExt] = useState<SubtitleTrack | null>(null)

  const landscape = width > height
  // Sideways is fullscreen; a tall video asks for it in portrait with the button.
  const fullscreen = landscape || tallFull

  // ---- Player events ----
  // Kept from the time updates: on close the player may already be released when this saves.
  const last = useRef({ at: 0, time: 0, duration: 0 })
  // Opened from a search result: paused just before the match, and the saved resume spot stays until it's played.
  const held = useRef(!startAt && start?.tMs != null)
  const save = useCallback(() => {
    if (!version && !vault && !held.current && last.current.duration) putPosition(api, item.id, last.current.time, last.current.duration)
  }, [api, item.id, version, vault])
  // Asked for now, so the answer is there by the time the video can play.
  const saved = useRef<Promise<number | null> | null>(null)
  if (!saved.current) saved.current = version || vault ? Promise.resolve(null) : getPosition(api, item.id)
  const playback = useQuery({ queryKey: [api.id, "playback", item.id], enabled: !version && !vault, staleTime: 60_000, queryFn: () => getPlayback(api, item.id) })

  // On the TV: this player holds still.
  const cast = useCastItem({
    item,
    kind: "video",
    active: !version && !vault,
    time: () => player.currentTime,
    duration: () => player.duration,
    onTaken: () => player.pause(),
    onEnded: (at) => {
      player.currentTime = at
    },
  })
  const outside = useQuery({
    queryKey: [api.id, "subtitles", item.id],
    enabled: !version && !vault,
    staleTime: 60_000,
    queryFn: () => api.get<SubtitlesResponse>(`/files/${item.id}/subtitles`).then((r) => r.tracks.filter((t) => t.source !== "embedded")),
  })
  const captions = useQuery({
    queryKey: [api.id, "captions", ext?.id],
    enabled: !!ext,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const r = await fetch(ext!.url)
      if (!r.ok) throw new Error("Couldn't load the subtitles.")
      return parseVtt(await r.text())
    },
  })
  const cue = ext && captions.data ? cueAt(captions.data, time) : null
  const castingRef = useRef(false)
  castingRef.current = cast.casting

  useEffect(() => {
    onPlayer(player, view.current)
    return () => onPlayer(null)
  }, [player, onPlayer])

  const nav = useRef(videoNav)
  nav.current = videoNav
  const sleepRef = useRef(sleep)
  sleepRef.current = sleep
  // A comment can take the time and jump back to it (lib/comment-anchor.ts).
  useEffect(
    () =>
      registerAnchor({
        id: item.id,
        time: () => player.currentTime,
        seek: (t) => {
          held.current = false
          player.currentTime = t
          player.play()
        },
      }),
    [item.id, player]
  )
  useEffect(() => {
    let first = true
    const subs = [
      player.addListener("playingChange", (e) => {
        setPlaying(e.isPlaying)
        if (e.isPlaying) held.current = false
        if (!e.isPlaying) save()
      }),
      player.addListener("statusChange", (e) => {
        setLoading(e.status === "loading" || e.status === "idle")
        if (e.status === "error") return onError()
        if (e.status !== "readyToPlay" || !first) return
        first = false
        setDuration(player.duration)
        // Picks up where it was left, with a way back to the start.
        // Asking before it has loaded is ignored, so it starts here. A new quality carries on from the same second.
        if (startAt) {
          player.currentTime = startAt
          if (!castingRef.current) player.play()
        } else if (held.current) {
          player.currentTime = Math.max(0, start!.tMs! / 1000 - SEARCH_LEAD_S)
        } else
          void saved.current!.then((at) => {
            if (castingRef.current) return
            if (offerResume(at, player.duration)) setResume(at)
            else player.play()
          })
        player.generateThumbnailsAsync(0, { maxWidth: 64 }).then(([f]) => f && setWide(f.width >= f.height), () => {})
      }),
      player.addListener("sourceLoad", (e) => setDuration(e.duration)),
      player.addListener("timeUpdate", (e) => {
        setTime(e.currentTime)
        setBuffered(e.bufferedPosition)
        last.current.time = e.currentTime
        last.current.duration = player.duration
        if (Date.now() - last.current.at > 15_000) {
          last.current.at = Date.now()
          save()
        }
      }),
      player.addListener("playToEnd", () => {
        last.current.time = player.duration
        save()
        if (sleepRef.current === "end") {
          player.pause()
          return setSleep(null)
        }
        if (player.loop) return
        if (nav.current?.next) setUpNext(UP_NEXT_S)
      }),
    ]
    return () => {
      subs.forEach((s) => s.remove())
      save()
    }
  }, [player, startAt, save, onError])

  // ---- Controls showing and hiding ----
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const poke = useCallback(() => {
    setShown(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => {
      if (player.playing) setShown(false)
    }, HIDE_MS)
  }, [player])
  useEffect(() => {
    if (playing) poke()
    else {
      if (hideTimer.current) clearTimeout(hideTimer.current)
      setShown(true)
    }
  }, [playing, poke])
  useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
  }, [])

  // The top bar comes and goes with the controls.
  useEffect(() => onBars(cast.casting || (shown && !locked && !pip && menu === null)), [cast.casting, shown, locked, pip, menu, onBars])
  // The pager holds still in fullscreen and while locked, so a drag can seek.
  useEffect(() => onZoom(fullscreen || locked), [fullscreen, locked, onZoom])
  useEffect(() => onFullscreen(fullscreen), [fullscreen, onFullscreen])

  // ---- Rotation ----
  const autoTurned = useRef(false)
  useEffect(() => {
    if (wide && !landscape && !autoTurned.current && !screen.rotationLocked) native?.orient?.("landscape", true)
    if (wide !== null) autoTurned.current = true
  }, [wide, landscape])

  const toggleFull = () => {
    poke()
    setRotLocked((screen.rotationLocked = false))
    if (fullscreen) {
      setTallFull(false)
      if (landscape) native?.orient?.("portrait", true)
    } else if (wide === false) setTallFull(true)
    else native?.orient?.("landscape", true)
  }
  const toggleRotLock = () => {
    poke()
    native?.orient?.(rotLocked ? "auto" : "lock", false)
    flash({ icon: DeviceRotate, text: rotLocked ? "Rotation unlocked" : "Rotation locked" })
    setRotLocked((screen.rotationLocked = !rotLocked))
  }

  // ---- Feedback ----
  const hudTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flash = useCallback((h: Hud | null, ms = 700) => {
    if (hudTimer.current) clearTimeout(hudTimer.current)
    setHud(h)
    if (h) hudTimer.current = setTimeout(() => setHud(null), ms)
  }, [])

  // ---- Actions ----
  const toggle = () => {
    poke()
    setUpNext(null)
    setResume(null)
    if (player.playing) player.pause()
    else if (duration && player.currentTime >= duration - 0.5) player.replay()
    else player.play()
  }
  const seekTo = (t: number) => {
    player.currentTime = clamp(t, 0, duration || Infinity)
    setTime(player.currentTime)
  }

  const tapSeekTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const doubleTap = (x: number) => {
    const side = x < width * 0.4 ? -1 : x > width * 0.6 ? 1 : 0
    if (!side) return toggle()
    player.seekBy(side * SKIP)
    setTapSeek((s) => ({ side, total: s && s.side === side ? s.total + SKIP : SKIP }))
    if (tapSeekTimer.current) clearTimeout(tapSeekTimer.current)
    tapSeekTimer.current = setTimeout(() => setTapSeek(null), 700)
  }

  // ---- Scrub thumbnails: one asked for at a time, the latest wins ----
  const want = useRef<number | null>(null)
  const busy = useRef(false)
  const askThumb = useCallback(
    async (t: number) => {
      want.current = t
      if (busy.current) return
      busy.current = true
      while (want.current !== null) {
        const at = want.current
        want.current = null
        try {
          const [f] = await player.generateThumbnailsAsync(at, { maxWidth: 192 })
          if (f) setThumb(f)
        } catch {}
      }
      busy.current = false
    },
    [player]
  )
  useEffect(() => {
    if (scrub === null) {
      want.current = null
      setThumb(null)
    } else askThumb(scrub)
  }, [scrub, askThumb])

  // ---- Gestures ----
  const lockTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showLockHint = () => {
    setLockHint(true)
    if (lockTimer.current) clearTimeout(lockTimer.current)
    lockTimer.current = setTimeout(() => setLockHint(false), HIDE_MS)
  }
  const scrubRef = useRef(scrub)
  scrubRef.current = scrub
  const drag = useRef<{ mode: "pending" | "bright" | "vol" | "seek" | null; from: number }>({ mode: null, from: 0 })
  const boosted = useRef<number | null>(null)
  // One gesture tree always: swapping it while mounted breaks the detector, so the lock turns it off instead
  // and a plain catcher on top takes the taps (a gesture here would steal them from the unlock button).
  const tap = Gesture.Tap()
    .enabled(!locked)
    .runOnJS(true)
    .onEnd(() => {
      if (shown && player.playing) setShown(false)
      else poke()
    })
  const dbl = Gesture.Tap()
    .enabled(!locked)
    .numberOfTaps(2)
    .maxDelay(250)
    .runOnJS(true)
    .onEnd((e) => doubleTap(e.x))
  // Out of fullscreen, sideways drags belong to the pager.
  const pan = Gesture.Pan().enabled(!locked).runOnJS(true)
  if (fullscreen) pan.minDistance(12)
  else pan.activeOffsetY([-12, 12]).failOffsetX([-16, 16])
  pan
    .onStart(() => {
      drag.current = { mode: "pending", from: 0 }
    })
    .onUpdate((e) => {
      // The direction is picked on the first real movement: at the start there's none yet.
      if (drag.current.mode === "pending") {
        if (!e.translationX && !e.translationY) return
        const x0 = e.x - e.translationX
        const y0 = e.y - e.translationY
        // A swipe in from any edge is the system's (back, bars), not ours.
        if (x0 < EDGE || x0 > width - EDGE || y0 < EDGE || y0 > height - EDGE) drag.current = { mode: null, from: 0 }
        else if (Math.abs(e.translationX) > Math.abs(e.translationY)) drag.current = { mode: "seek", from: player.currentTime }
        else if (!native?.volume) drag.current = { mode: null, from: 0 }
        else if (x0 < width / 2) drag.current = { mode: "bright", from: native.brightness?.() ?? 0.5 }
        else drag.current = { mode: "vol", from: native.volume() }
      }
      const { mode, from } = drag.current
      if (mode === "seek") {
        const t = clamp(from + (e.translationX / width) * Math.min(duration, 120), 0, duration)
        setScrub(t)
        const d = Math.round(t - from)
        flash({ icon: d < 0 ? Rewind : FastForward, text: `${d < 0 ? "−" : "+"}${clock(Math.abs(d))}  ·  ${clock(t)}` }, 60_000)
      } else if (mode === "bright" || mode === "vol") {
        const level = clamp(from - e.translationY / (height * 0.6))
        if (mode === "bright") native?.setBrightness?.(level)
        else native?.setVolume?.(level)
        flash({ icon: mode === "bright" ? Sun : level ? SpeakerHigh : SpeakerX, level }, 60_000)
      }
    })
    .onEnd(() => {
      if (drag.current.mode === "seek" && scrubRef.current !== null) seekTo(scrubRef.current)
      setScrub(null)
      flash(null)
      drag.current = { mode: null, from: 0 }
    })
  const hold = Gesture.LongPress()
    .enabled(!locked)
    .minDuration(450)
    .runOnJS(true)
    .onStart(() => {
      if (!player.playing) return
      boosted.current = player.playbackRate
      player.playbackRate = 2
      flash({ icon: FastForward, text: "2× speed" }, 60_000)
    })
    .onFinalize(() => {
      if (boosted.current === null) return
      player.playbackRate = boosted.current
      boosted.current = null
      flash(null)
    })
  const pinch = Gesture.Pinch()
    .enabled(!locked)
    .runOnJS(true)
    .onEnd((e) => {
      const next = e.scale > 1.1 ? "cover" : e.scale < 0.9 ? "contain" : null
      if (!next || next === fit) return
      setFit(next)
      flash({ icon: MagnifyingGlassPlus, text: next === "cover" ? "Zoomed to fill" : "Fit to screen" })
    })
  const gesture = Gesture.Race(pinch, pan, hold, Gesture.Exclusive(dbl, tap))


  // Back undoes the lock hint, then fullscreen, before it closes the previewer.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (locked) {
        showLockHint()
        return true
      }
      if (!fullscreen) return false
      toggleFull()
      return true
    })
    return () => sub.remove()
  })

  // ---- Sleep timer and up next ----
  useEffect(() => {
    if (typeof sleep !== "number") return
    const stop = runSleep(
      sleep,
      (g) => (player.volume = g),
      () => {
        player.pause()
        setSleep(null)
        flash({ icon: Pause, text: "Sleep timer: paused" }, 2000)
      }
    )
    return () => {
      stop()
      try {
        player.volume = 1
      } catch {}
    }
  }, [sleep, player, flash])
  useEffect(() => {
    if (upNext === null) return
    if (upNext <= 0) {
      setUpNext(null)
      nav.current?.go(1)
      return
    }
    const t = setTimeout(() => setUpNext(upNext - 1), 1000)
    return () => clearTimeout(t)
  }, [upNext])

  useEffect(() => {
    player.playbackRate = rate
  }, [rate, player])
  useEffect(() => {
    player.loop = loop
  }, [loop, player])

  const fade = useAnimatedStyle(() => ({ opacity: still ? (shown ? 1 : 0) : withTiming(shown ? 1 : 0, { duration: 180 }) }))
  const showControls = !locked && !pip && !cast.casting
  const sideGutter = Math.max(16, inset.left, inset.right)

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <GestureDetector gesture={gesture}>
        <View style={{ flex: 1 }} collapsable={false}>
          <VideoView
            ref={view}
            player={player}
            nativeControls={false}
            contentFit={fit}
            allowsPictureInPicture
            startsPictureInPictureAutomatically
            onPictureInPictureStart={() => setPip(true)}
            onPictureInPictureStop={() => setPip(false)}
            style={{ flex: 1 }}
            accessibilityLabel={item.name}
          />
        </View>
      </GestureDetector>

      {loading && !pip && (
        <View pointerEvents="none" style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" color="#fff" accessibilityLabel="Loading" />
        </View>
      )}

      {cue && !pip && !cast.casting && (
        <View pointerEvents="none" style={{ position: "absolute", left: sideGutter + 16, right: sideGutter + 16, bottom: bottom + (shown && showControls ? 120 : 32), alignItems: "center" }}>
          <Text variant="body" color="#fff" accessibilityLiveRegion="none" style={{ textAlign: "center", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, backgroundColor: "rgba(0,0,0,0.7)", overflow: "hidden" }}>
            {cue.text}
          </Text>
        </View>
      )}

      {tapSeek && (
        <View pointerEvents="none" style={{ position: "absolute", top: 0, bottom: 0, [tapSeek.side < 0 ? "left" : "right"]: 0, width: "35%", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 999 }}>
          {tapSeek.side < 0 ? <Rewind size={32} weight="fill" color="#fff" /> : <FastForward size={32} weight="fill" color="#fff" />}
          <Text variant="label" color="#fff">{`${tapSeek.side < 0 ? "−" : "+"}${tapSeek.total}s`}</Text>
        </View>
      )}

      {hud && !pip && (
        <View pointerEvents="none" style={{ position: "absolute", top: height * 0.18, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, height: 44, borderRadius: 22, backgroundColor: "rgba(0,0,0,0.7)" }}>
          <hud.icon size={20} color="#fff" weight="fill" />
          {hud.level !== undefined && (
            <View style={{ width: 120, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.25)" }}>
              <View style={{ width: `${Math.round(hud.level * 100)}%`, height: 4, borderRadius: 2, backgroundColor: "#fff" }} />
            </View>
          )}
          {hud.text && <Text variant="label" color="#fff" style={{ fontVariant: ["tabular-nums"] }}>{hud.text}</Text>}
        </View>
      )}

      {scrub !== null && thumb && !pip && (
        <View pointerEvents="none" style={{ position: "absolute", bottom: bottom + 120, alignSelf: "center", borderRadius: radius.card, overflow: "hidden", borderWidth: 1, borderColor: "rgba(255,255,255,0.3)" }}>
          <Image source={thumb} style={{ width: 192, height: thumb.height * (192 / thumb.width) }} accessibilityIgnoresInvertColors />
        </View>
      )}

      {showControls && (
        <Animated.View pointerEvents={shown ? "box-none" : "none"} style={[{ position: "absolute", inset: 0 }, fade]}>
          <View pointerEvents="box-none" style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 20 }}>
            {videoNav?.prev ? <Round icon={SkipBack} label="Previous video" onPress={() => videoNav.go(-1)} /> : videoNav?.next ? <View style={{ width: 48 }} /> : null}
            <Round icon={Rewind} label={`Back ${SKIP} seconds`} onPress={() => { poke(); player.seekBy(-SKIP) }} />
            <Round big icon={playing ? Pause : Play} label={playing ? "Pause" : "Play"} onPress={toggle} hidden={loading} />
            <Round icon={FastForward} label={`Forward ${SKIP} seconds`} onPress={() => { poke(); player.seekBy(SKIP) }} />
            {videoNav?.next ? <Round icon={SkipForward} label="Next video" onPress={() => videoNav.go(1)} /> : videoNav?.prev ? <View style={{ width: 48 }} /> : null}
          </View>
          <View style={{ paddingBottom: bottom + 4, paddingHorizontal: sideGutter, paddingTop: 8, backgroundColor: "rgba(0,0,0,0.55)" }}>
            <SeekBar
              time={scrub ?? time}
              buffered={buffered}
              duration={duration}
              onScrub={(t) => {
                poke()
                setScrub(t)
              }}
              onSeek={(t) => {
                seekTo(t)
                setScrub(null)
              }}
            />
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text variant="caption" color="#fff" style={{ fontVariant: ["tabular-nums"], paddingRight: 8 }}>
                {clock(scrub ?? time)} / {clock(duration)}
              </Text>
              <View style={{ flex: 1 }} />
              <IconButton icon={Lock} label="Lock touch" onPress={() => { setLocked(true); showLockHint() }} />
              {native?.orient && <IconButton icon={DeviceRotate} label={rotLocked ? "Unlock rotation" : "Lock rotation"} color={rotLocked ? c.brand : "#fff"} onPress={toggleRotLock} />}
              <Pressable onPress={() => { poke(); setMenu("speed") }} accessibilityRole="button" accessibilityLabel={`Playback speed ${rate} times`} style={{ minWidth: 48, height: 48, alignItems: "center", justifyContent: "center" }}>
                <Text variant="label" color={rate === 1 ? "#fff" : c.brand} style={{ fontVariant: ["tabular-nums"] }}>{fmtRate(rate)}</Text>
              </Pressable>
              <IconButton icon={GearSix} label="Video settings" onPress={() => { poke(); setMenu("main") }} />
              <IconButton icon={fullscreen ? ArrowsIn : ArrowsOut} label={fullscreen ? "Exit full screen" : "Full screen"} onPress={toggleFull} />
            </View>
          </View>
        </Animated.View>
      )}

      {(resume !== null || upNext !== null) && showControls && (
        <View style={{ position: "absolute", left: sideGutter, right: sideGutter, bottom: bottom + 112, alignItems: "flex-start" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 16, borderRadius: 24, backgroundColor: "rgba(23,23,23,0.92)", borderWidth: 1, borderColor: c.border }}>
            <Text variant="bodySmall" color="#fff" style={{ fontVariant: ["tabular-nums"] }}>
              {upNext !== null ? `Next video in ${upNext}` : `Resume from ${clock(resume ?? 0)}`}
            </Text>
            {upNext !== null ? (
              <>
                <Chip label="Play now" onPress={() => { setUpNext(null); videoNav?.go(1) }} />
                <Chip label="Cancel" onPress={() => setUpNext(null)} />
              </>
            ) : (
              <>
                <Chip label="Resume" onPress={() => { seekTo(resume ?? 0); setResume(null); player.play() }} />
                <Chip label="Start over" onPress={() => { setResume(null); player.play() }} />
              </>
            )}
          </View>
        </View>
      )}

      {locked && <Pressable style={{ position: "absolute", inset: 0 }} onPress={showLockHint} accessibilityLabel="Screen locked. Show unlock button" />}
      {locked && lockHint && (
        <View style={{ position: "absolute", bottom: bottom + 48, alignSelf: "center", alignItems: "center", gap: 8 }}>
          <Round big icon={LockOpen} label="Unlock touch" onPress={() => { setLocked(false); setLockHint(false); poke() }} />
          <Text variant="caption" color="#fff">Screen locked. Tap to unlock.</Text>
        </View>
      )}

      {cast.casting && <CastRemote item={item} kind="video" top={top} nav={videoNav} />}
      {cast.sheet}
      {customSleep && <CustomSleep onSet={(m) => setSleep(Date.now() + m * 60_000)} onClose={() => setCustomSleep(false)} />}
      {menu && (
        <SettingsSheet
          menu={menu}
          onMenu={setMenu}
          player={player}
          rate={rate}
          onRate={(r) => {
            setRate(r)
            setSpeed("video", r)
          }}
          fit={fit}
          onFit={setFit}
          loop={loop}
          onLoop={setLoop}
          sleep={sleep}
          onSleep={setSleep}
          onCustomSleep={() => setCustomSleep(true)}
          external={outside.data ?? []}
          externalOn={ext}
          externalFailed={captions.isError}
          onExternal={(t) => {
            if (t) player.subtitleTrack = null
            setExt(t)
          }}
          quality={quality}
          copies={copies}
          onQuality={(q) => onQuality(q, player.currentTime)}
          copyState={playback.data?.canMakeCopy ? (playback.data.copies.some((x) => x.status === "pending") ? "pending" : "can") : null}
          onMakeCopy={() =>
            makeCopy(api, item.id).then(
              () => {
                snack({ text: "Making a data-saver copy. It appears here when it's ready." })
                void queries.invalidateQueries({ queryKey: [api.id, "playback", item.id] })
              },
              (e) => snack({ text: errorText(e), error: true })
            )
          }
        />
      )}
    </View>
  )
}

function Round({ icon: I, label, onPress, big, hidden }: { icon: Icon; label: string; onPress: () => void; big?: boolean; hidden?: boolean }) {
  const size = big ? 72 : 48
  return (
    <View style={{ borderRadius: size / 2, overflow: "hidden", opacity: hidden ? 0 : 1 }}>
      <Pressable
        onPress={onPress}
        disabled={hidden}
        android_ripple={{ color: c.ripple }}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={{ width: size, height: size, alignItems: "center", justifyContent: "center", backgroundColor: big ? "rgba(0,0,0,0.45)" : "transparent" }}
      >
        <I size={big ? 36 : 28} weight="fill" color="#fff" />
      </Pressable>
    </View>
  )
}

const Chip = ({ label, onPress }: { label: string; onPress: () => void }) => (
  <Pressable onPress={onPress} accessibilityRole="button" style={{ height: 44, paddingHorizontal: 12, justifyContent: "center" }}>
    <Text variant="label" color={c.brand}>{label}</Text>
  </Pressable>
)

function SeekBar({ time, buffered, duration, onScrub, onSeek }: { time: number; buffered: number; duration: number; onScrub: (t: number) => void; onSeek: (t: number) => void }) {
  const [w, setW] = useState(1)
  const [dragging, setDragging] = useState(false)
  const at = (e: GestureResponderEvent) => clamp(e.nativeEvent.locationX / w) * duration
  const pct = (t: number) => `${duration ? clamp(t / duration) * 100 : 0}%` as const
  return (
    <View
      onLayout={(e) => setW(e.nativeEvent.layout.width || 1)}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => {
        setDragging(true)
        onScrub(at(e))
      }}
      onResponderMove={(e) => onScrub(at(e))}
      onResponderRelease={(e) => {
        setDragging(false)
        onSeek(at(e))
      }}
      onResponderTerminate={() => setDragging(false)}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Position"
      accessibilityValue={{ text: `${clock(time)} of ${clock(duration)}` }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(e) => onSeek(time + (e.nativeEvent.actionName === "increment" ? SKIP : -SKIP))}
      style={{ height: 32, justifyContent: "center" }}
    >
      <View pointerEvents="none" style={{ height: dragging ? 6 : 4, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.25)", overflow: "hidden" }}>
        <View style={{ position: "absolute", top: 0, bottom: 0, width: pct(buffered), backgroundColor: "rgba(255,255,255,0.4)" }} />
        <View style={{ position: "absolute", top: 0, bottom: 0, width: pct(time), backgroundColor: c.brand }} />
      </View>
      <View pointerEvents="none" style={{ position: "absolute", left: pct(time), marginLeft: dragging ? -9 : -7, width: dragging ? 18 : 14, height: dragging ? 18 : 14, borderRadius: 9, backgroundColor: c.brand }} />
    </View>
  )
}

type SettingsProps = {
  menu: Menu
  onMenu: (m: Menu | null) => void
  player: VideoPlayer
  rate: number
  onRate: (r: number) => void
  fit: VideoContentFit
  onFit: (f: VideoContentFit) => void
  loop: boolean
  onLoop: (l: boolean) => void
  sleep: Sleep
  onSleep: (s: Sleep) => void
  onCustomSleep: () => void
  // Subtitle files drawn by the page, not by the player.
  external: SubtitleTrack[]
  externalOn: SubtitleTrack | null
  externalFailed: boolean
  onExternal: (t: SubtitleTrack | null) => void
  quality: Quality
  copies: number[]
  onQuality: (q: Quality) => void
  // Owners can ask for a data-saver copy; "pending" while the worker makes it.
  copyState: "can" | "pending" | null
  onMakeCopy: () => void
}

function SettingsSheet({ menu, onMenu, player, rate, onRate, fit, onFit, loop, onLoop, sleep, onSleep, onCustomSleep, external, externalOn, externalFailed, onExternal, quality, copies, onQuality, copyState, onMakeCopy }: SettingsProps) {
  const subs = player.availableSubtitleTracks
  const audio = player.availableAudioTracks
  const trackName = (t: { label?: string; language?: string; name?: string }, i: number) => t.label || t.name || t.language || `Track ${i + 1}`
  const tick = (on: boolean) => (on ? <Check size={20} color={c.brand} weight="bold" /> : undefined)
  const back = <SheetRow label="Back" icon={<CaretLeft size={20} color={c.foreground} />} stay onPress={() => onMenu("main")} />

  return (
    <Sheet onClose={() => onMenu(null)}>
      {menu === "main" && (
        <>
          <SheetRow label="Playback speed" detail={fmtRate(rate)} stay onPress={() => onMenu("speed")} />
          {(subs.length > 0 || external.length > 0) && <SheetRow label="Subtitles" detail={externalOn ? externalOn.label : player.subtitleTrack ? trackName(player.subtitleTrack, subs.findIndex((s) => s.id === player.subtitleTrack?.id)) : "Off"} stay onPress={() => onMenu("subs")} />}
          {audio.length > 1 && <SheetRow label="Audio track" detail={player.audioTrack ? trackName(player.audioTrack, audio.findIndex((a) => a.id === player.audioTrack?.id)) : "Default"} stay onPress={() => onMenu("audio")} />}
          <SheetRow label="Picture" detail={FITS.find((f) => f.fit === fit)?.label} stay onPress={() => onMenu("fit")} />
          <SheetRow label="Loop" detail={loop ? "On" : "Off"} selected={loop} trailing={tick(loop)} stay onPress={() => onLoop(!loop)} />
          <SheetRow label="Sleep timer" detail={sleepDetail(sleep, "End of video")} stay onPress={() => onMenu("sleep")} />
          {copies.length > 0 && <SheetRow label="Quality" detail={qualityLabel(quality)} stay onPress={() => onMenu("quality")} />}
          {copyState && <SheetRow label={copyState === "pending" ? "Making data-saver copy…" : "Make data-saver copy"} detail={copyState === "pending" ? undefined : "A smaller version for mobile data and casting"} onPress={copyState === "pending" ? () => {} : onMakeCopy} />}
        </>
      )}
      {menu === "speed" && (
        <>
          {back}
          <SheetDivider />
          {SPEEDS.map((s) => <SheetRow key={s} label={s === 1 ? "Normal" : fmtRate(s)} selected={s === rate} trailing={tick(s === rate)} onPress={() => onRate(s)} />)}
        </>
      )}
      {menu === "subs" && (
        <>
          {back}
          <SheetDivider />
          <SheetRow label="Off" selected={!player.subtitleTrack && !externalOn} trailing={tick(!player.subtitleTrack && !externalOn)} onPress={() => { player.subtitleTrack = null; onExternal(null) }} />
          {subs.map((t, i) => <SheetRow key={t.id ?? i} label={trackName(t, i)} detail={t.language} selected={!externalOn && player.subtitleTrack?.id === t.id} trailing={tick(!externalOn && player.subtitleTrack?.id === t.id)} onPress={() => { onExternal(null); player.subtitleTrack = t }} />)}
          {external.map((t) => (
            <SheetRow key={t.id} label={t.label} detail={externalOn?.id === t.id && externalFailed ? "Couldn't load" : t.source === "speech" ? "Made by Nimbus" : "Subtitle file"} selected={externalOn?.id === t.id} trailing={tick(externalOn?.id === t.id)} onPress={() => onExternal(t)} />
          ))}
        </>
      )}
      {menu === "audio" && (
        <>
          {back}
          <SheetDivider />
          {audio.map((t, i) => <SheetRow key={t.id ?? i} label={trackName(t, i)} detail={t.language} selected={player.audioTrack?.id === t.id} trailing={tick(player.audioTrack?.id === t.id)} onPress={() => (player.audioTrack = t)} />)}
        </>
      )}
      {menu === "fit" && (
        <>
          {back}
          <SheetDivider />
          {FITS.map((f) => <SheetRow key={f.fit} label={f.label} selected={f.fit === fit} trailing={tick(f.fit === fit)} onPress={() => onFit(f.fit)} />)}
        </>
      )}
      {menu === "quality" && (
        <>
          {back}
          <SheetDivider />
          {(["original", ...[...copies].sort((x, y) => y - x)] as Quality[]).map((q) => <SheetRow key={q} label={qualityLabel(q)} selected={q === quality} trailing={tick(q === quality)} onPress={() => q !== quality && onQuality(q)} />)}
        </>
      )}
      {menu === "sleep" && (
        <>
          {back}
          <SheetDivider />
          <SleepRows sleep={sleep} endLabel="End of video" onSleep={onSleep} onCustom={onCustomSleep} />
        </>
      )}
    </Sheet>
  )
}
