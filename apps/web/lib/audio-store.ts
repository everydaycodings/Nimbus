"use client"

// The one audio player of the app: a queue, shuffle and repeat, speed, a sleep timer, resume,
// cover art, the OS media keys and Cast. It lives outside React on a detached <audio>, so it keeps
// playing while you move around; the previewer's player and the mini-player just show its state.
import type { Item } from "@/lib/files"

import { previewUrl } from "@/app/(app)/upload-actions"
import {
  castHandlers,
  castLoad,
  castPick,
  castSeek,
  castStop,
  castStore,
  castToggle,
  startCast,
} from "@/lib/cast"
import { coverArt } from "@/lib/cover-art"
import {
  createResume,
  createSleep,
  loadSpeed,
  makeStore,
  saveSpeed,
  type Resume,
} from "@/lib/media-extras"
import { playOrder, stepPos, type Repeat } from "@/lib/player-rules"

let el: HTMLAudioElement | null = null
let loadId = 0
let coverBlob: Blob | null = null
export const audioSleep = createSleep(() => el)

export const audioStore = makeStore({
  tracks: [] as Item[],
  // Positions in `tracks` in play order, and where we are in it.
  order: [] as number[],
  pos: 0,
  shuffle: false,
  repeat: "off" as Repeat,
  playing: false,
  time: 0,
  duration: 0,
  speed: 1,
  loading: false,
  error: null as string | null,
  cover: null as string | null,
  resume: null as Resume | null,
  // A vault or public-link track: it stops when its viewer closes, since the URL dies with it.
  ephemeral: false,
  // The previewer's player is showing, so the mini-player stays hidden.
  viewing: 0,
  casting: false,
})

const get = audioStore.get
export const audioCurrent = () => {
  const s = get()
  return s.tracks[s.order[s.pos]] as Item | undefined
}
const onCast = () => get().casting && castStore.get().connected

function audio() {
  if (el) return el
  el = new Audio()
  el.preload = "auto"
  el.preservesPitch = true
  const speed = loadSpeed("audio")
  el.playbackRate = el.defaultPlaybackRate = speed
  audioStore.set({ speed })
  el.onplay = el.onpause = () => audioStore.set({ playing: !el!.paused })
  el.ontimeupdate = () => {
    audioStore.set({ time: el!.currentTime })
    position()
  }
  el.ondurationchange = () => audioStore.set({ duration: el!.duration || 0 })
  el.onended = () => {
    if (audioSleep.ended()) return audioStore.set({ playing: false })
    advance(true)
  }
  el.onerror = () => audioStore.set({ error: "This track can't play.", loading: false })
  castStore.subscribe(() => {
    if (!get().casting) return
    const c = castStore.get()
    if (!c.connected) return
    audioStore.set({ playing: c.playing, time: c.time, duration: c.duration })
  })
  mediaSession()
  return el
}

// ---- Queue ----
// Starts a queue at `index`. `url` is a track the caller already has a URL for.
export function audioPlay(
  tracks: Item[],
  index: number,
  opts: { url?: string; ephemeral?: boolean } = {}
) {
  audio()
  const { order, pos } = playOrder(tracks.length, index, get().shuffle)
  audioStore.set({ tracks, order, pos, ephemeral: Boolean(opts.ephemeral) })
  return load(pos, opts.url)
}

async function load(pos: number, firstUrl?: string) {
  const a = audio()
  const s = get()
  const it = s.tracks[s.order[pos]]
  s.resume?.dispose()
  if (s.cover) URL.revokeObjectURL(s.cover)
  coverBlob = null
  audioStore.set({ pos, time: 0, duration: 0, loading: true, error: null, cover: null, resume: null })
  const stamp = ++loadId
  if (onCast()) return playOnCast(it)
  const url = firstUrl ?? (await previewUrl(it.id, null, true).catch(() => null))
  if (stamp !== loadId) return
  if (!url) return audioStore.set({ error: "Couldn't open this track.", loading: false })
  a.src = url
  a.playbackRate = get().speed
  audioStore.set({ loading: false, resume: s.ephemeral ? null : createResume(a, it.id) })
  a.play().catch(() => {})
  updateMetadata()
  if (!s.ephemeral) cover(it, url, stamp)
}

async function cover(it: Item, url: string, stamp: number) {
  const read = async (a: number, b: number) =>
    new Uint8Array(await (await fetch(url, { headers: { Range: `bytes=${a}-${b - 1}` } })).arrayBuffer())
  try {
    const pic = await coverArt(read, it.size)
    if (!pic || stamp !== loadId) return
    coverBlob = new Blob([pic.data as BlobPart], { type: pic.type })
    audioStore.set({ cover: URL.createObjectURL(coverBlob) })
    updateMetadata()
  } catch {}
}

function advance(auto: boolean) {
  const s = get()
  const p = stepPos(s.order.length, s.pos, 1, s.repeat, auto)
  if (p === null) return auto && audioStore.set({ playing: false })
  if (p === s.pos && audio().src && !onCast()) {
    audio().currentTime = 0
    audio().play().catch(() => {})
  } else load(p)
}
export const audioNext = () => advance(false)
export function audioPrev() {
  const s = get()
  if (s.time > 3) return audioSeek(0)
  const p = stepPos(s.order.length, s.pos, -1, s.repeat, false)
  if (p === null) audioSeek(0)
  else load(p)
}
export function audioJump(track: number) {
  const s = get()
  const { order, pos } = playOrder(s.tracks.length, track, s.shuffle)
  audioStore.set({ order, pos })
  load(pos)
}
export function audioShuffle() {
  const s = get()
  const shuffle = !s.shuffle
  const { order, pos } = playOrder(s.tracks.length, s.order[s.pos], shuffle)
  audioStore.set({ shuffle, order, pos })
}
export const audioRepeat = () =>
  audioStore.set({ repeat: ({ off: "all", all: "one", one: "off" } as const)[get().repeat] })

// ---- Transport ----
export function audioToggle() {
  if (onCast()) return castToggle()
  const a = audio()
  if (a.paused) a.play().catch(() => {})
  else a.pause()
}
export function audioPause() {
  if (el && !el.paused) el.pause()
}
export function audioSeek(t: number) {
  if (onCast()) return castSeek(t)
  audio().currentTime = t
}
export function audioSpeed(s: number) {
  const a = audio()
  a.playbackRate = a.defaultPlaybackRate = s
  audioStore.set({ speed: s })
  saveSpeed("audio", s)
}
export function audioView(by: 1 | -1) {
  audioStore.set({ viewing: Math.max(get().viewing + by, 0) })
}
export function audioStop() {
  loadId++
  const s = get()
  s.resume?.dispose()
  if (s.cover) URL.revokeObjectURL(s.cover)
  if (s.casting) castStop()
  if (el) {
    el.pause()
    el.removeAttribute("src")
    el.load()
  }
  audioSleep.cancel()
  audioStore.set({ tracks: [], order: [], pos: 0, playing: false, cover: null, resume: null, casting: false, time: 0, duration: 0 })
  if ("mediaSession" in navigator) navigator.mediaSession.metadata = null
}

// ---- Cast ----
async function playOnCast(it: Item, startAt = 0) {
  audio().pause()
  audioStore.set({ loading: false })
  castHandlers({
    finished: () => advance(true),
    next: audioNext,
    end: (t) => {
      audioStore.set({ casting: false })
      castHandlers({})
      const a = audio()
      if (a.src) {
        a.currentTime = t
        a.play().catch(() => {})
      }
    },
  })
  await castLoad({ id: it.id, name: it.name, kind: "audio", startAt })
}

// The Cast button: pick a TV if needed, then move this track over at the same spot.
export async function audioCast() {
  const it = audioCurrent()
  if (!it) return
  startCast()
  if (!castStore.get().connected) await castPick()
  if (!castStore.get().connected) return
  audioStore.set({ casting: true })
  playOnCast(it, get().time)
}

// ---- Media Session: OS media keys, lock screen and notification ----
function updateMetadata() {
  const it = audioCurrent()
  if (!("mediaSession" in navigator) || !it) return
  const { cover } = get()
  navigator.mediaSession.metadata = new MediaMetadata({
    title: it.name.replace(/\.[^.]+$/, ""),
    artist: "Nimbus",
    artwork: cover && coverBlob ? [{ src: cover, type: coverBlob.type }] : [],
  })
}
function position() {
  const a = audio()
  if (!("mediaSession" in navigator) || !(a.duration > 0)) return
  try {
    navigator.mediaSession.setPositionState({
      duration: a.duration,
      position: Math.min(a.currentTime, a.duration),
      playbackRate: a.playbackRate,
    })
  } catch {}
}
function mediaSession() {
  if (!("mediaSession" in navigator)) return
  const set = (a: MediaSessionAction, f: MediaSessionActionHandler) => {
    try {
      navigator.mediaSession.setActionHandler(a, f)
    } catch {}
  }
  set("play", audioToggle)
  set("pause", audioToggle)
  set("previoustrack", audioPrev)
  set("nexttrack", audioNext)
  set("seekbackward", (d) => audioSeek(Math.max(get().time - (d.seekOffset ?? 10), 0)))
  set("seekforward", (d) => audioSeek(get().time + (d.seekOffset ?? 10)))
  set("seekto", (d) => d.seekTime != null && audioSeek(d.seekTime))
  set("stop", audioStop)
}
