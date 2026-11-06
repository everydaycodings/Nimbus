// Downloads and Open with: what's running, its progress and its cancel button, on every screen.
// ponytail: these run in the JS process and stop if Android kills the app; the Kotlin uploader in Phase 5 is the place for background work.
import type { Item, PreviewResponse, Version } from "@nimbus/shared/api"
import { formatBytes } from "@nimbus/shared/file-rules"
import { fetch as streamingFetch } from "expo/fetch"
import { Directory, File } from "expo-file-system"
import * as Sharing from "expo-sharing"
import { X } from "phosphor-react-native"
import { useCallback, useMemo, useSyncExternalStore } from "react"
import { Pressable, View, useWindowDimensions } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { useSnack } from "@/components/snackbar"
import { Text } from "@/components/ui"
import { ApiError, errorText } from "./api"
import { fetchToCache } from "./file-cache"
import { useApi } from "./files"
import { native } from "./native"
import { whilePicking } from "./picking"
import { usePrefs } from "./prefs"
import { c, radius } from "./theme"

type Transfer = { id: number; name: string; bytes: number; total: number; cancel: () => void }

let transfers: Transfer[] = []
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((fn) => fn())
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}
let nextId = 1

export async function track<T>(name: string, total: number, task: (progress: (bytes: number, total?: number) => void, signal: AbortSignal) => Promise<T>) {
  const stop = new AbortController()
  const id = nextId++
  transfers = [...transfers, { id, name, bytes: 0, total, cancel: () => stop.abort() }]
  emit()
  // Progress arrives far more often than anyone can see it.
  let last = 0
  try {
    return await task((bytes, t) => {
      const now = Date.now()
      if (now - last < 150) return
      last = now
      transfers = transfers.map((x) => (x.id === id ? { ...x, bytes, total: t || x.total } : x))
      emit()
    }, stop.signal)
  } finally {
    transfers = transfers.filter((x) => x.id !== id)
    emit()
  }
}

const cancelled = (e: unknown) => e instanceof Error && (e.name === "AbortError" || /abort|cancel/i.test(e.message))

const zipName = () => `Nimbus ${new Date().toISOString().slice(0, 10)}.zip`

export function useTransfers() {
  const api = useApi()
  const snack = useSnack()
  const [prefs, setPrefs] = usePrefs(api.id)

  return useMemo(() => {
    const { server, token } = api.account

    const chooseFolder = async () => {
      try {
        const dir = await whilePicking(() => Directory.pickDirectoryAsync(prefs.downloadDir))
        setPrefs({ downloadDir: dir.uri })
        return dir
      } catch {
        return null // Backed out of the picker.
      }
    }

    // Android can take access back, or the folder can go, so a saved one is checked first.
    const destination = async () => {
      if (prefs.downloadDir) {
        const saved = new Directory(prefs.downloadDir)
        try {
          if (saved.exists) return saved
        } catch {}
      }
      return chooseFolder()
    }

    const save = async (dir: Directory, name: string, mime: string, total: number, response: (signal: AbortSignal) => Promise<Response>) => {
      let file: File | null = null
      try {
        await track(name, total, async (progress, signal) => {
          const res = await response(signal)
          if (!res.ok || !res.body) throw new ApiError(res.status, "error", "The server couldn't send this file. Try again.")
          file = dir.createFile(name, mime)
          const writer = file.writableStream().getWriter()
          const reader = res.body.getReader()
          let bytes = 0
          const size = Number(res.headers.get("content-length")) || total
          try {
            for (;;) {
              const { done, value } = await reader.read()
              if (done) break
              await writer.write(value)
              bytes += value.length
              progress(bytes, size)
            }
            await writer.close()
          } catch (e) {
            await writer.abort().catch(() => {})
            throw e
          }
        })
        snack({ text: `Saved “${file!.name || name}”.` })
      } catch (e) {
        try {
          ;(file as File | null)?.delete()
        } catch {}
        if (!cancelled(e)) snack({ text: errorText(e), error: true })
      }
    }

    const storageUrl = async (item: Item, version?: Version) =>
      (await api.get<PreviewResponse>(`/items/${item.id}/preview${version ? `?v=${version.id}` : ""}`)).url

    return {
      chooseFolder,
      destination,
      // One file saves as itself. Several, or any folder, come as one ZIP from the server.
      download: async (items: Item[], version?: Version) => {
        const dir = await destination()
        if (!dir) return
        const one = items.length === 1 && items[0].kind === "file" ? items[0] : null
        if (one) {
          const mime = (version ? version.mime : one.mime) ?? "application/octet-stream"
          return save(dir, one.name, mime, version?.size ?? one.size, async (signal) =>
            (await streamingFetch(await storageUrl(one, version), { signal })) as unknown as Response
          )
        }
        const body = items.map((i) => `ids=${encodeURIComponent(i.id)}`).join("&")
        return save(dir, zipName(), "application/zip", 0, (signal) =>
          streamingFetch(`${server}/api/zip`, {
            method: "POST",
            body,
            signal,
            credentials: "omit",
            headers: { authorization: `Bearer ${token}`, origin: "nimbus://", "content-type": "application/x-www-form-urlencoded" },
          }) as unknown as Promise<Response>
        )
      },
      openWith: async (item: Item, version?: Version) => {
        // The installed app hands the other app a Nimbus document, so what it saves comes back as a new version.
        // Expo Go, an older install or an older version of the file falls through to a read-only copy.
        const view = (native as { viewDocument?: (account: string, id: string, mime: string) => Promise<boolean> | boolean } | null)?.viewDocument
        if (!version && typeof view === "function") {
          try {
            if (await view.call(native, api.id, item.id, item.mime ?? "")) return
          } catch {}
        }
        try {
          const file = await track(item.name, version?.size ?? item.size, (progress, signal) =>
            fetchToCache(api.id, item.id, version?.id ?? item.version, () => storageUrl(item, version), { signal, onProgress: progress })
          )
          const mimeType = (version ? version.mime : item.mime) ?? undefined
          if (await file.canPreview({ mimeType }).catch(() => false)) await file.preview({ mimeType, title: item.name })
          else await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: item.name })
        } catch (e) {
          if (!cancelled(e)) snack({ text: e instanceof ApiError ? e.message : "No app on this phone could open that file.", error: true })
        }
      },
    }
  }, [api, prefs.downloadDir, setPrefs, snack])
}

// Sits above the tabs and the previewer's content, and takes no space when idle.
export function TransferBar() {
  const list = useSyncExternalStore(subscribe, () => transfers)
  const inset = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const cancel = useCallback((t: Transfer) => t.cancel(), [])
  if (!list.length) return null
  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", top: inset.top + 68, left: 16, right: 16, alignItems: "center", gap: 8 }}
    >
      {list.map((t) => {
        const pct = t.total ? Math.min(100, Math.round((t.bytes / t.total) * 100)) : null
        return (
          <View
            key={t.id}
            accessibilityLiveRegion="none"
            style={{ width: "100%", maxWidth: Math.min(560, width), borderRadius: radius.control, backgroundColor: c.muted, borderWidth: 1, borderColor: c.border, overflow: "hidden" }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", paddingLeft: 16, minHeight: 48 }}>
              <View style={{ flex: 1 }}>
                <Text variant="label" numberOfLines={1}>
                  {t.name}
                </Text>
                <Text variant="caption" color={c.mutedForeground} style={{ fontVariant: ["tabular-nums"] }}>
                  {pct === null ? formatBytes(t.bytes) : `${pct}% of ${formatBytes(t.total)}`}
                </Text>
              </View>
              <Pressable
                onPress={() => cancel(t)}
                android_ripple={{ color: c.ripple, borderless: true, radius: 24 }}
                accessibilityRole="button"
                accessibilityLabel={`Cancel ${t.name}`}
                style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}
              >
                <X size={20} color={c.foreground} />
              </Pressable>
            </View>
            <View style={{ height: 2, backgroundColor: c.mutedStrong }}>
              {pct !== null && <View style={{ height: 2, width: `${pct}%`, backgroundColor: c.brand }} />}
            </View>
          </View>
        )
      })}
    </View>
  )
}
