// Camera backup's shape as Kotlin reports it, and the words and ring the app shows for it.
// Free of React Native so a test can run it.

export type BackupSettings = {
  enabled: boolean
  accountId: string | null
  // Items taken before this (ms) are left alone; 0 is everything.
  from: number
  // Extra albums, by MediaStore bucket id. The main camera is always in.
  albums: string[]
  mobileData: boolean
  videosWifiOnly: boolean
  chargingOnly: boolean
  reliable: boolean
  // Paused from the queue screen: no run sends anything until it's resumed.
  paused: boolean
}

export type BackupStatus = {
  state: "off" | "idle" | "running" | "waiting" | "failing" | "paused"
  // Why it's waiting or failing, in words.
  reason?: string
  done: number
  total: number
  lastAt?: number
  failed: { mediaId: string; name: string; error: string }[]
  // Skipped from the queue; older APKs leave it out.
  skipped?: { mediaId: string; name: string }[]
  // Android 14's "selected photos" access is partial.
  access: "all" | "partial" | "none"
}

export type Album = { id: string; name: string; count: number; bytes: number; camera: boolean }

export const DEFAULT_SETTINGS: BackupSettings = {
  enabled: false,
  accountId: null,
  from: 0,
  albums: [],
  mobileData: false,
  videosWifiOnly: true,
  chargingOnly: false,
  reliable: false,
  paused: false,
}

// One file in the backup queue, as Kotlin's backupQueue() lists it.
export type QueueRow = { id: string; name: string; mime: string; size: number; sent: number; status: "queued" | "waiting" | "uploading" | "paused" | "failed" }

// The avatar's ring: what backup is doing, at a glance. Null: no ring.
export function ringOf(settings: BackupSettings, status: BackupStatus, accountId: string) {
  if (!settings.enabled || settings.accountId !== accountId) return null
  if (status.state === "failing" || status.access === "none") return { color: "destructive" as const, progress: 1 }
  if ((status.state === "running" || status.state === "paused") && status.total > 0) return { color: "brand" as const, progress: Math.min(1, status.done / status.total) }
  return { color: "brand" as const, progress: 1 }
}

// The status strip's two lines.
export function describe(status: BackupStatus, now = Date.now()) {
  const last = status.lastAt ? `Last backed up ${ago(now - status.lastAt)}` : "Nothing backed up yet"
  switch (status.state) {
    case "off":
      return { title: "Photo backup is off", detail: "Photos and videos on this phone aren't being copied to Nimbus." }
    case "running":
      return { title: `Backing up ${Math.min(status.total, status.done + 1)} of ${status.total}`, detail: last }
    case "waiting":
      return { title: status.reason ?? "Waiting", detail: last }
    case "paused":
      return { title: "Photo backup is paused", detail: status.total ? `${status.done} of ${status.total} done · ${last}` : last }
    case "failing":
      return { title: status.reason ?? "Photo backup has stopped", detail: last }
    default:
      return { title: "All backed up", detail: last }
  }
}

function ago(ms: number) {
  const min = Math.round(ms / 60_000)
  if (min < 1) return "just now"
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  return `${d} day${d === 1 ? "" : "s"} ago`
}
