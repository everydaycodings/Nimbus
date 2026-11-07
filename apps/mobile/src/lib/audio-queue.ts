// One audio queue for the whole app: the audio files of the folder being previewed, played by a
// native playlist so it carries on with the screen off and shows lock-screen and notification controls
// (play, pause, next, previous, seek). Closing the previewer stops it. Vault audio never comes here.
import type { Item, PreviewResponse } from "@nimbus/shared/api"
import { createAudioPlaylist, setAudioModeAsync, type AudioPlaylist } from "expo-audio"
import Storage from "expo-sqlite/kv-store"
import { useSyncExternalStore } from "react"

import { queueWindow, resumeAt } from "./audio-rules"
import { offlineFile } from "./file-cache"

export type Queue = { account: string; items: Item[]; playlist: AudioPlaylist }
type Api = { id: string; get: <T>(path: string) => Promise<T> }

let queue: Queue | null = null
let teardown: (() => void) | null = null
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((fn) => fn())
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

export const useQueue = () => useSyncExternalStore(subscribe, () => queue)

const key = (account: string, id: string) => `audio.pos.${account}.${id}`

export function savedPosition(account: string, id: string) {
  try {
    return Number(Storage.getItemSync(key(account, id))) || 0
  } catch {
    return 0
  }
}

function savePosition(account: string, id: string, position: number, duration: number) {
  try {
    const at = resumeAt(position, duration)
    if (at) Storage.setItemSync(key(account, id), String(Math.floor(at)))
    else Storage.removeItemSync(key(account, id))
  } catch {}
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
  const urls = await Promise.all(window.map((i) => urlOf(api, i)))
  const tracks = window.flatMap((item, n) => (urls[n] ? [{ item, uri: urls[n]! }] : []))
  const first = tracks.findIndex((t) => t.item.id === items[index].id)
  if (first < 0) throw new Error("Couldn't play this file.")

  await setAudioModeAsync({ shouldPlayInBackground: true, playsInSilentMode: true, interruptionMode: "doNotMix" })
  const playlist = createAudioPlaylist({ sources: tracks.map((t) => ({ uri: t.uri })), updateInterval: 500 })
  const q: Queue = { account: api.id, items: tracks.map((t) => t.item), playlist }
  queue = q

  let current = first
  let seeked = -1
  let lastSave = 0
  const status = playlist.addListener("playlistStatusUpdate", (s) => {
    current = s.currentIndex
    const item = q.items[current]
    if (!item || !s.isLoaded) return
    // Pick a track up where it was left, once it has loaded.
    if (seeked !== current) {
      seeked = current
      const at = resumeAt(savedPosition(api.id, item.id), s.duration)
      if (at) void playlist.seekTo(at)
    } else if (Date.now() - lastSave > 5000) {
      lastSave = Date.now()
      savePosition(api.id, item.id, s.currentTime, s.duration)
    }
  })
  const changedTrack = playlist.addListener("trackChanged", (e) => {
    const item = q.items[e.currentIndex]
    if (item) playlist.updateLockScreenMetadata(meta(item))
    // The one just played starts over next time.
    const done = q.items[e.previousIndex]
    if (done) savePosition(api.id, done.id, 0, 0)
    changed()
  })
  teardown = () => {
    const item = q.items[current]
    const s = playlist.currentStatus
    if (item && s) savePosition(api.id, item.id, s.currentTime, s.duration)
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
  playlist.play()
  changed()
  return q
}
