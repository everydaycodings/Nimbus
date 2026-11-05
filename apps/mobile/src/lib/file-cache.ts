// Recently opened documents, per account. Android may also clear this folder itself when space runs short.
import { Directory, File, Paths } from "expo-file-system"

import { CACHE_CAP, evictions } from "./preview-rules"

const folder = (account: string) => new Directory(Paths.cache, "previews", account.replace(/[^\w-]/g, "_"))

export const cachedFile = (account: string, id: string, version: string | null | undefined) =>
  new File(folder(account), `${id}-${version ?? "current"}`)

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
export async function fetchToCache(
  account: string,
  id: string,
  version: string | null | undefined,
  url: () => Promise<string>,
  options: { onProgress?: (bytes: number, total: number) => void; signal?: AbortSignal } = {}
) {
  const file = cachedFile(account, id, version)
  if (file.exists) return file
  const dir = folder(account)
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true })
  const part = new File(dir, `${file.name}.part`)
  if (part.exists) part.delete()
  try {
    await File.downloadFileAsync(await url(), part, {
      idempotent: true,
      signal: options.signal,
      onProgress: ({ bytesWritten, totalBytes }) => options.onProgress?.(bytesWritten, totalBytes),
    })
    part.move(file)
  } catch (e) {
    if (part.exists) part.delete()
    throw e
  }
  trim(account)
  return file
}
