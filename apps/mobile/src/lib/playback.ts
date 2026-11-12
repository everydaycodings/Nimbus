// Playback settings kept on this phone, the playback API calls, and the sleep timer's run-down.
import type { PlaybackInfo, PositionResponse } from "@nimbus/shared/api"
import Storage from "expo-sqlite/kv-store"

import { fadeGain, fadeStartsIn, keepsPosition, type Quality } from "./playback-rules"

type Api = { id: string; get: <T>(path: string) => Promise<T>; put: <T>(path: string, body?: unknown) => Promise<T>; post: <T>(path: string, body?: unknown) => Promise<T> }

const read = (key: string) => {
  try {
    return Storage.getItemSync(key)
  } catch {
    return null
  }
}
const write = (key: string, value: string) => void Storage.setItem(key, value).catch(() => {})

// ---- Settings (per phone) ----

const q = (v: string | null, fallback: Quality): Quality => (v === "original" ? "original" : v === "720" ? 720 : v === "480" ? 480 : fallback)

// What mobile data plays at; Wi-Fi always plays the original.
export const getMobileQuality = (): Quality => q(read("playback.mobile"), 480)
export const setMobileQuality = (v: Quality) => write("playback.mobile", String(v))

// Which copy Make available offline saves.
export type OfflineCopy = "original" | "data-saver"
export const getOfflineCopy = (): OfflineCopy => (read("offline.copy") === "data-saver" ? "data-saver" : "original")
export const setOfflineCopy = (v: OfflineCopy) => write("offline.copy", v)

// Speed is remembered apart for video and audio.
export const getSpeed = (kind: "video" | "audio") => Number(read(`playback.speed.${kind}`)) || 1
export const setSpeed = (kind: "video" | "audio", rate: number) => write(`playback.speed.${kind}`, String(rate))

// ---- Server ----

export const getPlayback = (api: Api, id: string) => api.get<PlaybackInfo>(`/files/${id}/playback`)
export const makeCopy = (api: Api, id: string) => api.post<{ status: "pending" | "done" }>(`/files/${id}/copy`)

// Where the account left this file; null for none or when the server can't be reached in time.
export function getPosition(api: Api, id: string) {
  const slow = new Promise<null>((done) => setTimeout(done, 2500, null))
  const got = api.get<PositionResponse>(`/files/${id}/position`).then((r) => r.position?.position ?? null, () => null)
  return Promise.race([got, slow])
}

// Fire and forget: losing one save only costs a few seconds of resume.
export function putPosition(api: Api, id: string, position: number, duration: number) {
  if (!keepsPosition(duration)) return
  api.put(`/files/${id}/position`, { position: Math.floor(position), duration: Math.floor(duration) }).catch(() => {})
}

// ---- Sleep timer ----

export type Sleep = number | "end" | null

// Counts down to `deadline` (ms since epoch): the sound fades over the last ten seconds, then `done`.
// Returns a stop function; the caller puts the volume back.
export function runSleep(deadline: number, setGain: (gain: number) => void, done: () => void) {
  let tick: ReturnType<typeof setInterval> | undefined
  const start = setTimeout(() => {
    tick = setInterval(() => {
      const left = deadline - Date.now()
      if (left <= 0) {
        clearInterval(tick)
        setGain(0)
        done()
      } else setGain(fadeGain(left))
    }, 250)
  }, fadeStartsIn(deadline, Date.now()))
  return () => {
    clearTimeout(start)
    clearInterval(tick)
  }
}
