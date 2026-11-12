// Casting to a TV (Google Cast, Google's Default Media Receiver). The library is a native module that
// Expo Go and phones without Play services don't have, so everything here works without it:
// the hooks say "not casting" and the button stays hidden.
import type { CastUrlResponse, Item, SubtitlesResponse } from "@nimbus/shared/api"
import { useEffect, useState } from "react"
import { NativeModules } from "react-native"
import type * as Lib from "react-native-google-cast"

import type { ApiError } from "./api"
import { castRefreshIn } from "./playback-rules"

type Api = { account: { server: string; token: string }; id: string; get: <T>(path: string) => Promise<T> }
export type CastKind = CastUrlResponse["kind"]

const lib: typeof Lib | null = NativeModules.RNGCCastContext ? require("react-native-google-cast") : null

// Fixed per run, so each of these is always the same hook.
export const useCastState: () => Lib.CastState | null | undefined = lib ? lib.useCastState : () => null
export const useCastSession: () => Lib.CastSession | null = lib ? lib.useCastSession : () => null
export const useCastDevice: () => Lib.Device | null = lib ? lib.useCastDevice : () => null
export const useMediaStatus: () => Lib.MediaStatus | null = lib ? lib.useMediaStatus : () => null
export const useStreamPosition: () => number | null = lib ? lib.useStreamPosition : () => null
export const NativeCastButton = lib ? lib.CastButton : null

// The Cast button shows when the library is here, Play services work and a TV is around.
export function useCastShown() {
  const [services, setServices] = useState(false)
  const state = useCastState()
  useEffect(() => {
    lib?.CastContext.getPlayServicesState().then((s) => setServices(s === lib.PlayServicesState.SUCCESS), () => {})
  }, [])
  return services && !!state && state !== lib?.CastState.NO_DEVICES_AVAILABLE
}

export const useCasting = () => useCastState() === "connected"

export async function stopCasting() {
  stopRefresh()
  await lib?.CastContext.sessionManager.endCurrentSession(true).catch(() => {})
}

// ---- What the TV is showing ----

export type Loaded = { id: string; kind: CastKind; name: string; tracks: SubtitlesResponse["tracks"] }
let loaded: Loaded | null = null
let refresh: ReturnType<typeof setTimeout> | undefined
// Where the TV had got to, kept by the remote, so closing the cast hands the position back.
let lastPosition = 0
export const noteCastPosition = (s: number) => void (lastPosition = s)
export const castPosition = () => lastPosition

export function stopRefresh() {
  clearTimeout(refresh)
  loaded = null
}

const client = async () => (await lib?.CastContext.sessionManager.getCurrentCastSession())?.client ?? null

export type CastRequest = { item: Item; kind: CastKind; startAt?: number; duration?: number; autoplay?: boolean }

// Loads the file on the TV. Throws an ApiError: "no-copy" (409) when a video needs a copy that isn't ready.
export async function castLoad(api: Api, { item, kind, startAt = 0, duration = 0, autoplay = true }: CastRequest) {
  const media = await client()
  if (!media || !lib) throw new Error("Not connected to a TV.")
  clearTimeout(refresh)
  const r = await api.get<CastUrlResponse & { artUrl?: string }>(`/files/${item.id}/cast${duration > 0 ? `?duration=${Math.ceil(duration)}` : ""}`)
  const tracks = kind === "video" ? await api.get<SubtitlesResponse>(`/files/${item.id}/subtitles`).then((s) => s.tracks, () => []) : []
  const title = item.name.replace(/\.[^.]+$/, "")
  const images = r.artUrl ? [{ url: r.artUrl }] : undefined
  await media.loadMedia({
    autoplay,
    startTime: startAt,
    mediaInfo: {
      contentUrl: r.url,
      contentType: r.contentType,
      streamType: lib.MediaStreamType.BUFFERED,
      ...(duration > 0 ? { streamDuration: duration } : {}),
      metadata:
        kind === "audio" ? { type: "musicTrack", title, artist: "Nimbus", images } : kind === "image" ? { type: "photo", title } : { type: "movie", title, images },
      mediaTracks: tracks.map((t, i) => ({ id: i + 1, type: "text" as const, subtype: "subtitles" as const, name: t.label, contentId: t.url, contentType: "text/vtt" })),
    },
  })
  loaded = { id: item.id, kind, name: item.name, tracks }
  // The URL lapses; load again from where the TV is before it does. Photos are short enough not to need it.
  if (kind !== "image") schedule(api, { item, kind, duration }, new Date(r.expiresAt).getTime())
  return loaded
}

function schedule(api: Api, req: CastRequest, expiresAt: number) {
  refresh = setTimeout(async () => {
    const media = await client()
    if (!media || loaded?.id !== req.item.id) return
    const [at, status] = await Promise.all([media.getStreamPosition(), media.getMediaStatus()]).catch(() => [null, null] as const)
    // A new URL needs a new load; the track choice on the TV is lost with it (a few seconds' gap, once an hour or more).
    await castLoad(api, { ...req, startAt: at ?? 0, autoplay: status?.playerState === lib?.MediaPlayerState.PLAYING }).catch(() => {})
  }, castRefreshIn(expiresAt, Date.now()))
}

export const castLoaded = () => loaded

export const isNoCopy = (e: unknown) => (e as ApiError)?.code === "no-copy"
