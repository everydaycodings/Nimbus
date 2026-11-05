// The installed app's uploader: the queue lives in Kotlin, which sends rows back as they change.
import { PermissionsAndroid, Platform } from "react-native"

import type { NimbusAndroid } from "./native"
import type { UploadEngine } from "./uploads"
import type { UploadRow } from "./upload-plan"

export function nativeEngine(m: NimbusAndroid): UploadEngine {
  let rows: UploadRow[] = JSON.parse(m.uploads())
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach((fn) => fn())
  // Rows refused before they reached Kotlin live only here, so they survive Kotlin's updates.
  const refused = () => rows.filter((r) => r.id.startsWith("refused-"))
  m.addListener("uploads", (e) => {
    rows = [...JSON.parse(e.json ?? m.uploads()), ...refused()]
    emit()
  })
  return {
    rows: () => rows,
    subscribe(fn) {
      listeners.add(fn)
      return () => void listeners.delete(fn)
    },
    async add(jobs) {
      // Android 13 and up ask before an app may show notifications, including upload progress.
      if (Platform.OS === "android" && Platform.Version >= 33) PermissionsAndroid.request("android.permission.POST_NOTIFICATIONS").catch(() => {})
      await m.addUploads(JSON.stringify(jobs))
    },
    // Refused before it ever reached the queue: nothing to resume, so it stays in JS.
    refuse(accountId, name, error) {
      rows = [...rows, { id: `refused-${Date.now()}-${rows.length}`, accountId, name, mime: "", size: 0, sent: 0, status: "refused", error }]
      emit()
    },
    pause: (id) => m.pauseUpload(id),
    resume: (id) => m.resumeUpload(id),
    retry: (id) => m.retryUpload(id),
    cancel(id) {
      if (id.startsWith("refused-")) return this.drop(id)
      m.cancelUpload(id)
    },
    drop(id) {
      if (id.startsWith("refused-")) {
        rows = rows.filter((r) => r.id !== id)
        emit()
      } else m.dropUpload(id)
    },
    clear(accountId, everything) {
      rows = rows.filter((r) => !(r.id.startsWith("refused-") && r.accountId === accountId))
      m.clearUploads(accountId, everything)
      emit()
    },
    cancelAccount: (accountId) => m.cancelAccount(accountId),
  }
}
