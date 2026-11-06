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
  // Phase 7: set for a vault upload. planToken is then the vault plan token; Kotlin seals the file key.
  vault?: { vaultId: string; sealedName: string; nameTag: string; replaces?: string }
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
  // Phase 6, Files app (DocumentsProvider). Optional: older APKs don't have them.
  // The Files app lists Nimbus unless the lock is on (timeoutMs not null) and `ms` is older than the timeout, or lockNow ran.
  setUnlockedAt?(ms: number, timeoutMs: number | null): void
  lockNow?(): void
  // content:// URI of one item in the Files app's provider, for another app that must save back; null if signed out.
  documentUri?(accountId: string, itemId: string): string | null
  // Open with: starts a chooser for another app with read+write grants on the provider URI. False when locked, signed out or no app can open it.
  viewDocument?(accountId: string, itemId: string, mime: string): boolean
  // Tell open Files screens to reload this account's lists.
  notifyFilesChanged?(accountId: string): void
  // Phase 7, Vault. Optional: older APKs don't have them. Keys never reach JS; see the contract in plans/android-app.md.
  // JSON {handle, salt, kdf:{t,m}, wrapped, recoveryWrapped, recoveryCode}; the new key waits under `handle`.
  vaultCreate?(passphrase: string): Promise<string>
  vaultAdopt?(handle: string, accountId: string, vaultId: string): void
  // False: wrong secret.
  vaultUnlock?(accountId: string, vaultId: string, keysJson: string, secret: string, kind: "passphrase" | "recovery"): Promise<boolean>
  // JSON UpdateVaultKeyRequest; the vault must be open.
  vaultRewrap?(accountId: string, vaultId: string, passphrase: string): Promise<string>
  vaultLock?(accountId: string, vaultId: string): void
  vaultLockAll?(accountId: string | null): void
  vaultIsOpen?(accountId: string, vaultId: string): boolean
  // JSON ({n, t} | null)[] in the order given; null: can't be opened.
  vaultOpenNames?(accountId: string, vaultId: string, sealedJson: string[]): Promise<string>
  // JSON {sealed, tag}.
  vaultSealName?(accountId: string, vaultId: string, name: string, mime: string | null): Promise<string>
  // JSON string[] of name tags, in the order given.
  vaultNameTags?(accountId: string, vaultId: string, namesJson: string[]): Promise<string>
  vaultCacheDir?(accountId: string, vaultId: string): string
  // Streams url -> decrypt -> dest (a path or a content:// URI). Progress comes as "vault" events.
  vaultDecrypt?(jobId: string, accountId: string, vaultId: string, url: string, encKey: string, dest: string): Promise<void>
  vaultZip?(jobId: string, accountId: string, vaultId: string, itemsJson: string, dest: string): Promise<void>
  vaultCancel?(jobId: string): void
  vaultBioAvailable?(): Promise<boolean>
  vaultBioEnabled?(accountId: string, vaultId: string): boolean
  vaultBioEnable?(accountId: string, vaultId: string): Promise<"ok" | "cancel">
  vaultBioUnlock?(accountId: string, vaultId: string): Promise<"ok" | "cancel" | "invalidated" | "none">
  vaultBioDisable?(accountId: string, vaultId: string): void
  vaultForget?(accountId: string, vaultId: string | null): void
  setSecure?(on: boolean): void
  // `json`: the queue as UploadRow[]. "vault" events carry a decrypt job's progress in plaintext bytes.
  addListener(event: "uploads" | "share" | "backup" | "vault", listener: (e: { json?: string; jobId?: string; done?: number; total?: number }) => void): EventSubscription
}

export type SharedFile = { uri: string; name: string; size: number; mime: string }

export const native = requireOptionalNativeModule<NimbusAndroid>("NimbusAndroid")
