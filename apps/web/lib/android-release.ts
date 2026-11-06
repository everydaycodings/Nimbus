// The Android APKs this server offers: the latest GitHub release if it can be
// reached, else the ones bundled in apps/web/android (npm run release:android).
import "server-only"

import { readdir, stat } from "node:fs/promises"
import path from "node:path"

import { cached } from "@/lib/cache"

export const ABIS = ["arm64-v8a", "armeabi-v7a", "x86_64", "universal"] as const
export type Abi = (typeof ABIS)[number]
export type AndroidRelease = {
  version: string
  files: { abi: Abi; url: string; size: number }[]
}

export const APK_FILE = /^nimbus-(\d+\.\d+\.\d+)-(arm64-v8a|armeabi-v7a|x86_64|universal)\.apk$/
export const BUNDLED_DIR = path.join(process.cwd(), "android")

async function fromGithub(): Promise<AndroidRelease | null> {
  const res = await fetch(
    "https://api.github.com/repos/everydaycodings/Nimbus/releases/latest",
    {
      headers: { "User-Agent": "nimbus-server", Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(5000),
    }
  )
  if (!res.ok) return null
  const r = (await res.json()) as {
    assets?: { name: string; size: number; browser_download_url: string }[]
  }
  return pick(
    (r.assets ?? []).map((a) => ({ name: a.name, size: a.size, url: a.browser_download_url }))
  )
}

function pick(list: { name: string; size: number; url: string }[]) {
  const files: AndroidRelease["files"] = []
  let version = ""
  for (const a of list) {
    const m = APK_FILE.exec(a.name)
    if (!m) continue
    version = m[1]
    files.push({ abi: m[2] as Abi, url: a.url, size: a.size })
  }
  files.sort((a, b) => ABIS.indexOf(a.abi) - ABIS.indexOf(b.abi))
  return files.length ? { version, files } : null
}

async function fromBundled() {
  const names = await readdir(BUNDLED_DIR).catch(() => [])
  const list = await Promise.all(
    names
      .filter((n) => APK_FILE.test(n))
      .map(async (name) => ({
        name,
        size: (await stat(path.join(BUNDLED_DIR, name))).size,
        url: `/android/${name}`,
      }))
  )
  return pick(list)
}

// GitHub's answer is cached an hour, "none" included, so it's asked at most once an hour.
// The bundled folder is read each time: it's cheap, and changes when the server is updated.
export async function androidRelease() {
  const gh = await cached<AndroidRelease | null>("android:github", 3600, () =>
    fromGithub().catch(() => null)
  )
  return gh ?? fromBundled()
}
