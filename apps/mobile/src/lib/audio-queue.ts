// One audio queue for the whole app: the audio files of the folder being previewed, played by a
// native playlist so it carries on with the screen off and shows lock-screen and notification controls
// (play, pause, next, previous, seek). Closing the previewer stops it. Vault audio never comes here.
import type { Item, PreviewResponse } from "@nimbus/shared/api"
import { createAudioPlaylist, setAudioModeAsync, type AudioPlaylist } from "expo-audio"
import { useSyncExternalStore } from "react"

import { queueWindow } from "./audio-rules"
import { offlineFile } from "./file-cache"
import { getPosition, getSpeed, putPosition, runSleep, type Sleep } from "./playback"
import { offerResume } from "./playback-rules"

export type Queue = { account: string; items: Item[]; playlist: AudioPlaylist }
type Api = { id: string; get: <T>(path: string) => Promise<T>; put: <T>(path: string, body?: unknown) => Promise<T>; post: <T>(path: string, body?: unknown) => Promise<T> }

let queue: Queue | null = null
let teardown: (() => void) | null = null
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((fn) => fn())
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

export const useQueue = () => useSyncExternalStore(subscribe, () => queue)

// What the player shows besides the queue itself: the sleep timer, and a long track waiting for "Resume / Start over".
type Extras = { sleep: Sleep; resume: { id: string; at: number } | null }
let extras: Extras = { sleep: null, resume: null }
let stopSleep: (() => void) | null = null
const setExtras = (change: Partial<Extras>) => {
  extras = { ...extras, ...change }
  changed()
}
export const useAudioExtras = () => useSyncExternalStore(subscribe, () => extras)

export function setSleep(sleep: Sleep) {
  stopSleep?.()
  stopSleep = null
  const playlist = queue?.playlist
  if (playlist) playlist.volume = 1
  if (typeof sleep === "number" && playlist) {
    stopSleep = runSleep(
      sleep,
      (g) => (playlist.volume = g),
      () => {
        playlist.pause()
        playlist.volume = 1
        stopSleep = null
        setExtras({ sleep: null })
      }
    )
  }
  setExtras({ sleep })
}

// "Resume from…" or "Start over", for the track that is waiting.
export function answerResume(resume: boolean) {
  const pending = extras.resume
  const playlist = queue?.playlist
  setExtras({ resume: null })
  if (!pending || !playlist) return
  if (resume) void playlist.seekTo(pending.at)
  playlist.play()
}

// The phone's own copy when it's kept offline, else a fresh download link.
async function urlOf(api: Api, item: Item) {
  const kept = offlineFile(api.id, item.id, item.version)
  if (kept?.exists) return kept.uri
  return (await api.get<PreviewResponse>(`/items/${item.id}/preview`).catch(() => null))?.url
}

const meta = (item: Item) => ({ title: item.name.replace(/\.[^.]+$/, ""), artist: "Nimbus" })

export function stopQueue() {
  teardown?.()
}

// Plays `items[index]` and the tracks around it. Throws when that track can't be fetched.
export async function startQueue(api: Api, items: Item[], index: number) {
  stopQueue()
  const { start, end } = queueWindow(items.length, index)
  const window = items.slice(start, end)
  const [urls, saved] = await Promise.all([Promise.all(window.map((i) => urlOf(api, i))), getPosition(api, items[index].id)])
  const tracks = window.flatMap((item, n) => (urls[n] ? [{ item, uri: urls[n]! }] : []))
  const first = tracks.findIndex((t) => t.item.id === items[index].id)
  if (first < 0) throw new Error("Couldn't play this file.")

  await setAudioModeAsync({ shouldPlayInBackground: true, playsInSilentMode: true, interruptionMode: "doNotMix" })
  const playlist = createAudioPlaylist({ sources: tracks.map((t) => ({ uri: t.uri })), updateInterval: 500 })
  playlist.playbackRate = getSpeed("audio")
  // A track with a place saved waits for the choice of where to start.
  const held = (saved ?? 0) > 5
  const q: Queue = { account: api.id, items: tracks.map((t) => t.item), playlist }
  queue = q

  let current = first
  let seeked = -1
  let lastSave = 0
  let seen = { id: "", time: 0, duration: 0 }
  const status = playlist.addListener("playlistStatusUpdate", (s) => {
    current = s.currentIndex
    const item = q.items[current]
    if (!item || !s.isLoaded) return
    seen = { id: item.id, time: s.currentTime, duration: s.duration }
    if (seeked !== current) {
      seeked = current
      if (held && current === first) {
        if (offerResume(saved, s.duration)) {
          playlist.pause()
          setExtras({ resume: { id: item.id, at: saved! } })
        } else playlist.play()
      }
    } else if (Date.now() - lastSave > 15_000) {
      lastSave = Date.now()
      putPosition(api, item.id, s.currentTime, s.duration)
    }
  })
  const changedTrack = playlist.addListener("trackChanged", (e) => {
    const item = q.items[e.currentIndex]
    if (item) playlist.updateLockScreenMetadata(meta(item))
    // The one just played starts over next time.
    const done = q.items[e.previousIndex]
    if (done && done.id === seen.id) putPosition(api, done.id, seen.duration, seen.duration)
    if (extras.resume) setExtras({ resume: null })
    if (extras.sleep === "end") {
      playlist.pause()
      setSleep(null)
    } else if (item) {
      // A long track picks up where it was left, when the choice comes in.
      void getPosition(api, item.id).then((at) => {
        const now = playlist.currentStatus
        if (queue !== q || q.items[playlist.currentIndex]?.id !== item.id || !now || !offerResume(at, now.duration) || now.currentTime > 5) return
        playlist.pause()
        setExtras({ resume: { id: item.id, at: at! } })
      })
    }
    changed()
  })
  teardown = () => {
    const item = q.items[current]
    const s = playlist.currentStatus
    if (item && s) putPosition(api, item.id, s.currentTime, s.duration)
    stopSleep?.()
    stopSleep = null
    extras = { sleep: null, resume: null }
    status.remove()
    changedTrack.remove()
    try {
      playlist.clearLockScreenControls()
      playlist.pause()
      playlist.destroy()
    } catch {}
    if (queue === q) queue = null
    teardown = null
    changed()
  }

  if (first > 0) playlist.skipTo(first)
  playlist.setActiveForLockScreen(true, meta(tracks[first].item), {
    showNextTrack: true,
    showPreviousTrack: true,
    showSeekBackward: true,
    showSeekForward: true,
    seekBackwardIntervalSeconds: 10,
    seekForwardIntervalSeconds: 10,
  })
  if (!held) playlist.play()
  changed()
  return q
}
