"use client"

/* eslint-disable @typescript-eslint/no-explicit-any -- Google's Cast sender SDK is a script with no bundled types */

// Chromecast through Google's Cast Web Sender SDK and its Default Media Receiver.
// The SDK script is loaded only in Chrome, and only once a player that can cast mounts.
// Everything else (Edge, Safari) falls back to the Remote Playback API in the video player.
import type {
  CastNoCopy,
  CastUrlResponse,
  SubtitlesResponse,
} from "@nimbus/shared/api"
import { useEffect } from "react"

import { makeStore, useStore } from "@/lib/media-extras"

export type CastSource = {
  id: string
  name: string
  kind: "video" | "audio" | "image"
  version?: string | null
  // Seconds, to size the URL's lifetime.
  duration?: number
  startAt?: number
  autoplay?: boolean
}

export type CastTrack = { id: number; label: string }

const SDK = "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1"
const REFRESH_BEFORE = 10 * 60_000

export const castStore = makeStore({
  // "off": not Chrome. "loading", "ready", or "failed" (blocked or unsupported).
  sdk: "off" as "off" | "loading" | "ready" | "failed",
  // At least one device is on the network.
  devices: false,
  connected: false,
  device: "",
  loaded: null as CastSource | null,
  busy: false,
  // "This video can't be cast yet." with a way to make the copy.
  problem: null as { message: string; canMakeCopy: boolean } | null,
  playing: false,
  time: 0,
  duration: 0,
  volume: 1,
  muted: false,
  subtitles: [] as CastTrack[],
  audioTracks: [] as CastTrack[],
  activeSubtitle: null as number | null,
  activeAudio: null as number | null,
})

// Called when the TV finishes what it was playing, and when the Cast session ends
// (with the last position), so the player that started it can carry on.
let onFinished: (() => void) | null = null
let onNext: (() => void) | null = null
let onEnd: ((time: number) => void) | null = null
export const castHandlers = (h: {
  finished?: (() => void) | null
  next?: (() => void) | null
  end?: ((time: number) => void) | null
}) => {
  onFinished = h.finished ?? null
  onNext = h.next ?? null
  onEnd = h.end ?? null
}
export const castHasNext = () => Boolean(onNext)
export const castNext = () => onNext?.()

let started = false
let player: any
let controller: any
let expires = 0
let refreshTimer = 0
let wasPlaying = false

const isChrome = () =>
  /Chrome\//.test(navigator.userAgent) && !/Edg\/|OPR\/|Firefox\//.test(navigator.userAgent)

const ctx = () => (window as any).cast?.framework?.CastContext?.getInstance()
const chromeCast = () => (window as any).chrome?.cast

// Loads the SDK the first time a player asks (Chrome only). Safe to call again.
export function startCast() {
  if (started) return
  started = true
  if (!isChrome()) return
  castStore.set({ sdk: "loading" })
  ;(window as any).__onGCastApiAvailable = (ok: boolean) => ok && setup()
  const s = document.createElement("script")
  s.src = SDK
  s.async = true
  s.onerror = () => castStore.set({ sdk: "failed" })
  document.head.append(s)
  // The callback never comes in browsers the SDK doesn't support.
  setTimeout(() => castStore.get().sdk === "loading" && castStore.set({ sdk: "failed" }), 8000)
}

function setup() {
  const fw = (window as any).cast.framework
  const c = fw.CastContext.getInstance()
  c.setOptions({
    receiverApplicationId: chromeCast().media.DEFAULT_MEDIA_RECEIVER_APP_ID,
    autoJoinPolicy: chromeCast().AutoJoinPolicy.ORIGIN_SCOPED,
  })
  player = new fw.RemotePlayer()
  controller = new fw.RemotePlayerController(player)
  const castState = () =>
    castStore.set({ devices: c.getCastState() !== "NO_DEVICES_AVAILABLE" })
  c.addEventListener(fw.CastContextEventType.CAST_STATE_CHANGED, castState)
  c.addEventListener(fw.CastContextEventType.SESSION_STATE_CHANGED, (e: any) => {
    const S = fw.SessionState
    if (e.sessionState === S.SESSION_STARTED || e.sessionState === S.SESSION_RESUMED)
      castStore.set({ connected: true, device: c.getCurrentSession()?.getCastDevice()?.friendlyName ?? "" })
    else if (e.sessionState === S.SESSION_ENDED) {
      const last = castStore.get().time
      clearTimeout(refreshTimer)
      castStore.set({ connected: false, loaded: null, problem: null, playing: false, time: 0, subtitles: [], audioTracks: [] })
      onEnd?.(last)
    }
  })
  controller.addEventListener(fw.RemotePlayerEventType.ANY_CHANGE, sync)
  castState()
  castStore.set({ sdk: "ready" })
}

function sync() {
  if (!player) return
  const ms = ctx()?.getCurrentSession()?.getMediaSession?.()
  const tracks: any[] = player.mediaInfo?.tracks ?? []
  const active: number[] = ms?.activeTrackIds ?? []
  const T = chromeCast()?.media.TrackType
  const subs = tracks.filter((t) => t.type === T?.TEXT)
  const audio = tracks.filter((t) => t.type === T?.AUDIO)
  const idle = player.playerState === "IDLE"
  if (idle && wasPlaying && ms?.idleReason === chromeCast()?.media.IdleReason.FINISHED) onFinished?.()
  wasPlaying = player.playerState === "PLAYING" || player.playerState === "BUFFERING"
  const s = castStore.get()
  castStore.set({
    // Photos have no clock; the rest follow the TV.
    playing: player.isMediaLoaded && !player.isPaused && !idle,
    // Keeps the last position while the TV's player is between media.
    time: player.isMediaLoaded ? player.currentTime : s.time,
    duration: player.isMediaLoaded ? player.duration : s.duration,
    volume: player.volumeLevel ?? 1,
    muted: Boolean(player.isMuted),
    subtitles: subs.map((t) => ({ id: t.trackId, label: t.name })),
    audioTracks: audio.length > 1 ? audio.map((t) => ({ id: t.trackId, label: t.name || `Track ${t.trackId}` })) : [],
    activeSubtitle: subs.find((t) => active.includes(t.trackId))?.trackId ?? null,
    activeAudio: audio.find((t) => active.includes(t.trackId))?.trackId ?? null,
  })
}

// Opens the browser's device picker.
export const castPick = () => ctx()?.requestSession().catch(() => {})

// Shows what the TV is playing, with its remote, until the session ends.
export async function castLoad(src: CastSource) {
  const session = ctx()?.getCurrentSession()
  if (!session) return
  clearTimeout(refreshTimer)
  castStore.set({ busy: true, problem: null })
  try {
    const q = new URLSearchParams()
    if (src.duration) q.set("duration", String(Math.ceil(src.duration)))
    if (src.version) q.set("v", src.version)
    const r = await fetch(`/api/v1/files/${src.id}/cast?${q}`)
    if (r.status === 409) {
      const b = (await r.json()) as CastNoCopy
      castStore.set({ problem: { message: b.message, canMakeCopy: b.canMakeCopy }, loaded: src })
      return
    }
    if (!r.ok) {
      const m = ((await r.json().catch(() => null)) as { message?: string } | null)?.message
      castStore.set({ problem: { message: m ?? "Couldn't cast this file.", canMakeCopy: false }, loaded: src })
      return
    }
    const info = (await r.json()) as CastUrlResponse
    const c = chromeCast()
    const media = new c.media.MediaInfo(info.url, info.contentType)
    media.streamType = c.media.StreamType.BUFFERED
    const meta = new c.media.GenericMediaMetadata()
    meta.metadataType = { video: 0, audio: 3, image: 4 }[info.kind]
    meta.title = src.name
    if (info.artUrl) meta.images = [new c.Image(info.artUrl)]
    media.metadata = meta
    if (info.kind === "video") {
      const subs = await fetch(`/api/v1/files/${src.id}/subtitles`)
        .then((x) => (x.ok ? (x.json() as Promise<SubtitlesResponse>) : { tracks: [] }))
        .catch(() => ({ tracks: [] }))
      media.tracks = subs.tracks.map((t, i) => {
        const tr = new c.media.Track(i + 1, c.media.TrackType.TEXT)
        tr.trackContentId = t.url
        tr.trackContentType = "text/vtt"
        tr.subtype = c.media.TextTrackType.SUBTITLES
        tr.name = t.label
        return tr
      })
    }
    const req = new c.media.LoadRequest(media)
    req.autoplay = src.autoplay ?? true
    req.currentTime = src.startAt ?? 0
    await session.loadMedia(req)
    expires = new Date(info.expiresAt).getTime()
    castStore.set({ loaded: src, time: src.startAt ?? 0, duration: src.duration ?? 0 })
    scheduleRefresh(src)
  } catch {
    castStore.set({ problem: { message: "Couldn't cast this file.", canMakeCopy: false }, loaded: src })
  } finally {
    castStore.set({ busy: false })
  }
}

// The TV keeps the URL it was given, so just before it runs out (a long pause) the
// media is loaded again with a fresh one at the same spot.
function scheduleRefresh(src: CastSource) {
  if (src.kind === "image") return
  refreshTimer = window.setTimeout(() => {
    const s = castStore.get()
    if (!s.connected || s.loaded?.id !== src.id) return
    if (Date.now() < expires - REFRESH_BEFORE) return scheduleRefresh(src)
    castLoad({ ...src, startAt: s.time, autoplay: s.playing, duration: s.duration || src.duration })
  }, 30_000)
}

export const castToggle = () => controller?.playOrPause()
export function castSeek(t: number) {
  player.currentTime = Math.max(0, t)
  controller.seek()
}
export const castSkip = (by: number) => castSeek(Math.min(player.currentTime + by, player.duration || Infinity))
export function castVolume(v: number) {
  player.volumeLevel = v
  controller.setVolumeLevel()
}
export const castMute = () => controller?.muteOrUnmute()
export const castStop = () => ctx()?.endCurrentSession(true)

// One text track, one audio track (Default Receiver: only as far as the stream allows), or off.
export function castTracks(subtitle: number | null, audio: number | null) {
  const ms = ctx()?.getCurrentSession()?.getMediaSession?.()
  if (!ms) return
  const ids = [subtitle, audio ?? castStore.get().activeAudio].filter((x): x is number => x != null)
  ms.editTracksInfo(new (chromeCast().media.EditTracksInfoRequest)(ids), () => {}, () => {})
}

// Starts the SDK for a component that has a Cast button, and says whether to show it.
export function useCastButton(enabled = true) {
  useEffect(() => {
    if (enabled) startCast()
  }, [enabled])
  const s = useStore(castStore)
  return enabled && s.sdk === "ready" && (s.devices || s.connected)
}

type Photo = { id: string; name: string; version: string | null }

// The Cast button on a photo: pick a TV if none is connected, then show the photo.
export async function castPhoto(p: Photo) {
  startCast()
  if (!castStore.get().connected) await castPick()
  if (castStore.get().connected) castLoad({ id: p.id, name: p.name, kind: "image", version: p.version })
}

// A photo on the TV follows the previewer or slideshow: whenever `item` changes while this
// session is showing photos it is sent over.
export function useCastFollow(item: Photo | undefined) {
  const s = useStore(castStore)
  const follow = s.connected && s.loaded?.kind === "image"
  useEffect(() => {
    if (follow && item) castPhoto(item)
    // Only a new photo or a new connection sends one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, s.connected])
}
