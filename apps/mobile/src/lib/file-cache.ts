// Recently opened documents, per account. Android may also clear this folder itself when space runs short.
import { Directory, File, Paths } from "expo-file-system"

import { safeAccount } from "./offline-rules"
import { CACHE_CAP, evictions } from "./preview-rules"

const folder = (account: string) => new Directory(Paths.cache, "previews", account.replace(/[^\w-]/g, "_"))

// Files kept offline live beside the app's own data, where Android never clears them.
export const offlineFolder = (account: string) => new Directory(Paths.document, "offline", safeAccount(account))
export const offlineFile = (account: string, id: string, version: string | null | undefined) =>
  new File(offlineFolder(account), `${id}-${version ?? "current"}`)

// An offline copy of that version is used before the cache is looked at.
export const cachedFile = (account: string, id: string, version: string | null | undefined) => {
  const kept = offlineFile(account, id, version)
  return kept.exists ? kept : new File(folder(account), `${id}-${version ?? "current"}`)
}

const files = (account: string) => {
  const dir = folder(account)
  return dir.exists ? dir.list().filter((f): f is File => f instanceof File) : []
}

export const cacheSize = (account: string) => files(account).reduce((n, f) => n + f.size, 0)

export function clearCache(account: string) {
  const dir = folder(account)
  if (dir.exists) dir.delete()
}

function trim(account: string) {
  const now = files(account).map((file) => ({ file, size: file.size, modified: file.modificationTime ?? 0 }))
  for (const { file } of evictions(now, CACHE_CAP)) file.delete()
}

// Downloads beside the final name and moves it into place, so a half-finished file is never read as whole.
export async function fetchTo(
  file: File,
  url: () => Promise<string>,
  options: { onProgress?: (bytes: number, total: number) => void; signal?: AbortSignal } = {}
) {
  const dir = file.parentDirectory
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true })
  const part = new File(dir, `${file.name}.part`)
  if (part.exists) part.delete()
  try {
    await File.downloadFileAsync(await url(), part, {
      idempotent: true,
      signal: options.signal,
      onProgress: ({ bytesWritten, totalBytes }) => options.onProgress?.(bytesWritten, totalBytes),
    })
    // Async in SDK 58: reading `file` before this settles sees nothing there.
    await part.move(file)
  } catch (e) {
    if (part.exists) part.delete()
    throw e
  }
  return file
}

export async function fetchToCache(
  account: string,
  id: string,
  version: string | null | undefined,
  url: () => Promise<string>,
  options: { onProgress?: (bytes: number, total: number) => void; signal?: AbortSignal } = {}
) {
  const file = cachedFile(account, id, version)
  if (file.exists) return file
  await fetchTo(file, url, options)
  trim(account)
  return file
}
