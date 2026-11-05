// Expo Go's uploader: tus while the app is open. The installed app uses Kotlin instead (upload-engine-native.ts).
// ponytail: stops if Android kills the app, and doesn't hash, so there's no "Same as…" here. Fine for a dev client.
// Picked videos get no thumbnail here either: expo-video can't open files under Expo Go's cache folder,
// whose name holds a "%". The installed app's folder doesn't.
import type { FinishUploadResponse } from "@nimbus/shared/api"
import { previewKind } from "@nimbus/shared/file-rules"
import { File } from "expo-file-system"
import * as Network from "expo-network"
import { Upload } from "tus-js-client"

import { json, send } from "./api"
import { firstFrameToWebp, imageToWebp } from "./thumbs"
import type { NativeJob } from "./native"
import type { UploadEngine } from "./uploads"
import type { UploadRow } from "./upload-plan"

const CONCURRENT = 3
const PART = 8 * 1024 * 1024

let rows: UploadRow[] = []
const jobs = new Map<string, { job: NativeJob; token: string; upload?: Upload }>()
const listeners = new Set<() => void>()
const emit = () => {
  listeners.forEach((fn) => fn())
}
let next = 1
let cellular = false
let lastTick = 0

// Shared across running uploads, like the web's: each books its share of the cap.
let nextSlot = 0
async function pace(bytes: number, cap: number) {
  const now = Date.now()
  const start = Math.max(now, nextSlot)
  nextSlot = start + (bytes / cap) * 1000
  await new Promise((ok) => setTimeout(ok, nextSlot - now))
}

const patch = (id: string, change: Partial<UploadRow>) => {
  rows = rows.map((r) => (r.id === id ? { ...r, ...change } : r))
}

const reader = (cap: number | null) => ({
  async openFile(input: { uri: string; size: number }) {
    const handle = new File(input.uri).open()
    return {
      size: input.size,
      async slice(start: number, end: number) {
        handle.offset = start
        // tus counts a part by its Blob-style `size`, which bytes don't have.
        const bytes = await handle.readBytes(Math.min(end, input.size) - start)
        const value = Object.assign(bytes, { size: bytes.length })
        if (cap) await pace(bytes.length, cap)
        return { value, done: end >= input.size }
      },
      close: () => handle.close(),
    }
  },
})

// The server's refusal is in the response's body.
function tusError(e: Error & { originalResponse?: { getBody(): string; getStatus(): number } | null }) {
  const res = e.originalResponse
  if (!res) return "Can't reach the server. Retry when you're back online."
  const body = res.getBody()?.trim()
  return body && body.length < 200 ? body : `The server refused this upload (${res.getStatus()}).`
}

async function thumb(job: NativeJob, token: string, nodeId: string, versionId: string) {
  const kind = previewKind(job.mime, job.name)
  if (kind !== "image" && kind !== "video") return
  let body: Uint8Array | undefined
  try {
    body = kind === "video" ? await firstFrameToWebp(job.uri) : await imageToWebp(job.uri)
  } catch {
    if (kind === "image") return // The server's worker draws images it knows.
  }
  await send(job.server, `/api/files/${nodeId}/thumb?v=${versionId}`, {
    method: "POST",
    token,
    headers: body ? { "content-type": "image/webp" } : undefined,
    body: body as unknown as BodyInit | undefined,
  }).catch(() => {})
}

async function finish(id: string, url: string) {
  const d = jobs.get(id)
  if (!d) return
  let nodeId: string | undefined
  try {
    const r = await json<FinishUploadResponse>(d.job.server, "/api/v1/uploads/finish", {
      method: "POST",
      token: d.token,
      body: JSON.stringify({ uploadUrl: url }),
    })
    nodeId = r.nodeId
    if (r.nodeId && r.versionId) await thumb(d.job, d.token, r.nodeId, r.versionId)
  } catch {} // The server's own tus hook lands the file anyway.
  patch(id, { status: "done", sent: d.job.size, nodeId })
  jobs.delete(id)
  emit()
  pump()
}

function begin(id: string) {
  const d = jobs.get(id)!
  patch(id, { status: "uploading", error: undefined })
  emit()
  const { job } = d
  d.upload ??= new Upload({ uri: job.uri, size: job.size } as never, {
    endpoint: job.tusUrl,
    uploadSize: job.size,
    // Under a cap, parts of about two seconds each so progress keeps moving.
    chunkSize: job.speedCap ? Math.round(Math.min(PART, Math.max(256 * 1024, job.speedCap * 2))) : PART,
    fileReader: reader(job.speedCap) as never,
    // ~3.5 min of retries, so a dropped Wi-Fi or a server restart doesn't fail it.
    retryDelays: [0, 1000, 3000, 5000, 10000, 20000, 30000, 60000, 90000],
    storeFingerprintForResuming: false,
    fingerprint: async () => id,
    metadata: { filename: job.path.split("/").pop()!, filetype: job.mime, token: job.planToken, path: job.path, onConflict: job.onConflict },
    onProgress: (sent) => {
      patch(id, { sent })
      const now = Date.now()
      if (now - lastTick < 200) return
      lastTick = now
      emit()
    },
    onError: (e) => {
      patch(id, { status: "failed", error: tusError(e as never) })
      emit()
      pump()
    },
    onSuccess: () => finish(id, d.upload!.url!),
  })
  d.upload.start()
}

function pump() {
  const waiting = rows.filter((r) => r.status === "waiting" || r.status === "queued")
  let running = rows.filter((r) => r.status === "uploading").length
  let changed = false
  for (const r of waiting) {
    const d = jobs.get(r.id)
    if (!d) continue
    const hold = d.job.wifiOnly && cellular
    const status = hold ? "waiting" : "queued"
    if (r.status !== status) {
      patch(r.id, { status })
      changed = true
    }
    if (hold || running >= CONCURRENT) continue
    begin(r.id)
    running++
  }
  if (changed) emit()
}

Network.getNetworkStateAsync().then((s) => {
  cellular = s.type === Network.NetworkStateType.CELLULAR
})
Network.addNetworkStateListener((s) => {
  cellular = s.type === Network.NetworkStateType.CELLULAR
  pump()
})

export const jsEngine: UploadEngine = {
  rows: () => rows,
  subscribe(fn) {
    listeners.add(fn)
    return () => void listeners.delete(fn)
  },
  add(list, token) {
    const added = list.map((job) => {
      const id = `js-${next++}`
      jobs.set(id, { job, token })
      const row: UploadRow = { id, accountId: job.accountId, name: job.name, mime: job.mime, size: job.size, sent: 0, status: "queued", asVersion: job.onConflict === "version" }
      return row
    })
    rows = [...rows, ...added]
    emit()
    pump()
  },
  refuse(accountId, name, error) {
    rows = [...rows, { id: `js-${next++}`, accountId, name, mime: "", size: 0, sent: 0, status: "refused", error }]
    emit()
  },
  pause(id) {
    jobs.get(id)?.upload?.abort()
    patch(id, { status: "paused" })
    emit()
    pump()
  },
  resume(id) {
    patch(id, { status: "queued" })
    pump()
    emit()
  },
  retry(id) {
    patch(id, { status: "queued", error: undefined })
    pump()
    emit()
  },
  cancel(id) {
    const d = jobs.get(id)
    d?.upload?.abort(true).catch(() => {})
    jobs.delete(id)
    rows = rows.filter((r) => r.id !== id)
    emit()
    pump()
  },
  drop(id) {
    rows = rows.filter((r) => r.id !== id)
    emit()
  },
  clear(accountId, everything) {
    rows = rows.filter((r) => r.accountId !== accountId || (r.status !== "done" && r.status !== "refused") || (!everything && !!r.duplicateOf))
    emit()
  },
  cancelAccount(accountId) {
    for (const r of rows.filter((x) => x.accountId === accountId)) this.cancel(r.id)
  },
}
