"use client"

// What the video player and the audio player share, with no React in the logic: speed
// remembered per device, the sleep timer, resume from where you stopped, and a tiny store
// the components read with useStore.
import type { PositionResponse } from "@nimbus/shared/api"
import { useSyncExternalStore } from "react"

import {
  RESUME_MIN_SEC,
  RESUME_END_SEC,
  resumeAction,
} from "@/lib/playback-rules"
import { fadeGain, parseSpeed, sleepLeftMs, type Sleep } from "@/lib/player-rules"

export function makeStore<T extends object>(init: T) {
  let state = init
  const subs = new Set<() => void>()
  return {
    get: () => state,
    set(patch: Partial<T>) {
      state = { ...state, ...patch }
      subs.forEach((f) => f())
    },
    subscribe(f: () => void) {
      subs.add(f)
      return () => void subs.delete(f)
    },
  }
}
export const useStore = <T extends object>(s: ReturnType<typeof makeStore<T>>) =>
  useSyncExternalStore(s.subscribe, s.get, s.get)

// ---- Speed: per device, separately for video and audio ----
export function loadSpeed(kind: "video" | "audio") {
  try {
    return parseSpeed(localStorage.getItem(`nimbus_speed_${kind}`))
  } catch {
    return 1
  }
}
export function saveSpeed(kind: "video" | "audio", speed: number) {
  try {
    localStorage.setItem(`nimbus_speed_${kind}`, String(speed))
  } catch {}
}

// ---- Sleep timer ----
// Counts down on a wall clock (or to the end of the track) and fades the volume over
// the last 10 s before pausing. The element's volume is put back afterwards.
export function createSleep(media: () => HTMLMediaElement | null) {
  const store = makeStore({ sleep: null as Sleep | null, left: 0 })
  let timer = 0
  let base: number | null = null

  function restore() {
    const m = media()
    if (m && base !== null) m.volume = base
    base = null
  }
  function tick() {
    const m = media()
    const s = store.get().sleep
    if (!m || !s) return
    const left = sleepLeftMs(s, Date.now(), m.duration - m.currentTime, m.playbackRate)
    if (left <= 0) {
      m.pause()
      return clear()
    }
    // Fade only while it plays; a paused player keeps counting.
    const gain = fadeGain(left)
    if (gain < 1 && !m.paused) {
      base ??= m.volume
      m.volume = base * gain
    }
    const secs = Math.ceil(left / 1000)
    if (secs !== store.get().left) store.set({ left: secs * 1000 })
  }
  function clear() {
    clearInterval(timer)
    restore()
    store.set({ sleep: null, left: 0 })
  }
  return {
    store,
    start(s: Sleep) {
      clearInterval(timer)
      restore()
      store.set({ sleep: s, left: 0 })
      timer = window.setInterval(tick, 250)
      tick()
    },
    cancel: clear,
    in(minutes: number) {
      this.start({ kind: "at", at: Date.now() + minutes * 60_000 })
    },
    // A track finished: true when it was the one the timer was waiting for, so don't go on.
    ended() {
      const wasEnd = store.get().sleep?.kind === "end"
      if (wasEnd) clear()
      return wasEnd
    },
  }
}
export type SleepTimer = ReturnType<typeof createSleep>

// ---- Resume (synced to the account through the position API) ----
const url = (id: string, v?: string | null) =>
  `/api/v1/files/${id}/position${v ? `?v=${v}` : ""}`

export async function fetchPosition(id: string, v?: string | null) {
  try {
    const r = await fetch(url(id, v))
    return r.ok ? ((await r.json()) as PositionResponse).position?.position ?? null : null
  } catch {
    return null
  }
}

const OFFER_MS = 15_000
const SAVE_EVERY = 15_000

// Watches one element: once it's known to be long media, asks where I left off ("offer"),
// then saves the position every 15 s, on pause, at the end and when the page closes.
// Nothing is saved while the offer is open, or it would overwrite what it's offering.
export function createResume(m: HTMLMediaElement, id: string, v?: string | null) {
  const store = makeStore({ offer: null as number | null })
  let asked = false
  let decided = false
  let last = 0
  let offerTimer = 0

  const save = () => {
    // readyState 0: the source is being swapped, and the time is not real.
    if (!decided || m.readyState < 1 || resumeAction(m.currentTime, m.duration) === "skip") return
    last = Date.now()
    fetch(url(id, v), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ position: m.currentTime, duration: m.duration }),
      keepalive: true,
    }).catch(() => {})
  }
  async function ask() {
    if (asked || !(m.duration > RESUME_MIN_SEC)) return
    asked = true
    const pos = await fetchPosition(id, v)
    if (pos !== null && pos > 5 && pos < m.duration - RESUME_END_SEC) {
      store.set({ offer: pos })
      offerTimer = window.setTimeout(() => answer(false), OFFER_MS)
    } else decided = true
  }
  function answer(resume: boolean) {
    clearTimeout(offerTimer)
    const pos = store.get().offer
    store.set({ offer: null })
    if (resume && pos !== null) m.currentTime = pos
    decided = true
    if (!resume) save()
  }
  const onTime = () => {
    ask()
    if (Date.now() - last > SAVE_EVERY) save()
  }
  m.addEventListener("durationchange", ask)
  m.addEventListener("timeupdate", onTime)
  m.addEventListener("pause", save)
  m.addEventListener("ended", save)
  window.addEventListener("pagehide", save)
  ask()
  return {
    store,
    resume: () => answer(true),
    startOver: () => {
      m.currentTime = 0
      answer(false)
    },
    dispose() {
      save()
      clearTimeout(offerTimer)
      m.removeEventListener("durationchange", ask)
      m.removeEventListener("timeupdate", onTime)
      m.removeEventListener("pause", save)
      m.removeEventListener("ended", save)
      window.removeEventListener("pagehide", save)
    },
  }
}
export type Resume = ReturnType<typeof createResume>

// "Make data-saver copy" (owner): null when queued, else the reason it can't be.
export async function makeCopy(id: string) {
  try {
    const r = await fetch(`/api/v1/files/${id}/copy`, { method: "POST" })
    if (r.ok) return null
    return ((await r.json()) as { message?: string }).message ?? "Couldn't make a copy."
  } catch {
    return "Couldn't make a copy."
  }
}
