import { native } from "./native"

// The daily On this day notice is scheduled by Kotlin (Memories.kt); Expo Go and older APKs don't have it.
export const noticeAvailable = typeof native?.memoriesSet === "function"

export type Notice = { enabled: boolean; hour: number; minute: number }
const OFF: Notice = { enabled: false, hour: 9, minute: 0 }

export function noticeState(): Notice {
  try {
    return { ...OFF, ...JSON.parse(native?.memoriesState?.() ?? "{}") }
  } catch {
    return OFF
  }
}

export const setNotice = (n: Notice) => native?.memoriesSet?.(n.enabled, n.hour, n.minute)

// "9:00 AM" or "09:00", as the phone writes times.
export const timeLabel = (hour: number, minute: number) => new Date(2000, 0, 1, hour, minute).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
