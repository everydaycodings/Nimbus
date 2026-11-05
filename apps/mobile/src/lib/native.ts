// The Kotlin module. Null in Expo Go, which can't load it, so every caller has a way of doing without.
import { requireOptionalNativeModule } from "expo"
import type { EventSubscription } from "expo-modules-core"

export type NativeJob = {
  accountId: string
  server: string
  tusUrl: string
  uri: string
  name: string
  size: number
  mime: string
  path: string
  planToken: string
  parentId: string | null
  onConflict: "version" | "rename"
  wifiOnly: boolean
  speedCap: number | null
}

export type NimbusAndroid = {
  setAccounts(json: string): void
  // Async: a shared file Android won't let the app keep is copied first.
  addUploads(jobs: string): Promise<void>
  uploads(): string
  pauseUpload(id: string): void
  resumeUpload(id: string): void
  retryUpload(id: string): void
  cancelUpload(id: string): void
  dropUpload(id: string): void
  clearUploads(accountId: string, everything: boolean): void
  cancelAccount(accountId: string): void
  // What another app shared in, as SharedFile[] JSON, once; empty when nothing's waiting.
  sharedFiles(): Promise<string>
  scanAvailable(): Promise<boolean>
  scan(): Promise<string | null>
  // The library's own name for a picked photo or video; null without photo access.
  mediaName?(assetId: string): string | null
  // BackupSettings and BackupStatus (backup-rules.ts) as JSON.
  backupSettings(): string
  setBackup(json: string): void
  backupStatus(): Promise<string>
  // Album[] with counts and sizes, from the whole library.
  backupAlbums(): Promise<string>
  retryBackup(): void
  // { count, bytes } of backed-up items older than `days` the server still has.
  freeUpCandidates(days: number): Promise<string>
  // How many Android removed, after its own confirmation.
  freeUp(days: number): Promise<number>
  // `json`: the queue as UploadRow[].
  addListener(event: "uploads" | "share" | "backup", listener: (e: { json?: string }) => void): EventSubscription
}

export type SharedFile = { uri: string; name: string; size: number; mime: string }

export const native = requireOptionalNativeModule<NimbusAndroid>("NimbusAndroid")
