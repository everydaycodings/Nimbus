"use client"

import { DownloadSimpleIcon } from "@phosphor-icons/react"
import { useEffect, useState } from "react"

import { buttonVariants } from "@/components/ui/button"
import type { AndroidRelease } from "@/lib/android-release"

type Abi = AndroidRelease["files"][number]["abi"]

const HINT: Record<Abi, string> = {
  "arm64-v8a": "Most phones from the last several years",
  "armeabi-v7a": "Older 32-bit phones",
  x86_64: "Emulators and Chromebooks",
  universal: "Works anywhere, larger download",
}

const mb = (n: number) => `${(n / 1024 ** 2).toFixed(0)} MB`

async function detect(): Promise<Abi | null> {
  // On a computer the hints describe the computer, not the phone it's for.
  if (!/Android/i.test(navigator.userAgent)) return null
  const uad = (navigator as { userAgentData?: { getHighEntropyValues?: (k: string[]) => Promise<{ architecture?: string; bitness?: string }> } }).userAgentData
  try {
    const v = await uad?.getHighEntropyValues?.(["architecture", "bitness"])
    if (v?.architecture === "arm") return v.bitness === "32" ? "armeabi-v7a" : "arm64-v8a"
    if (v?.architecture === "x86" && v.bitness === "64") return "x86_64"
  } catch {}
  return /Android/i.test(navigator.userAgent) ? "arm64-v8a" : null
}

export function AndroidDownload({ release }: { release: AndroidRelease | null }) {
  const [abi, setAbi] = useState<Abi | null>(null)
  useEffect(() => {
    detect().then(setAbi)
  }, [])
  if (!release) return null
  // Before (or without) detection, offer arm64 as the common case.
  const main =
    release.files.find((f) => f.abi === (abi ?? "arm64-v8a")) ??
    release.files.find((f) => f.abi === "universal") ??
    release.files[0]
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <a href={main.url} download className={buttonVariants()}>
          <DownloadSimpleIcon />
          Download for Android ({main.abi === "arm64-v8a" ? "arm64" : main.abi})
        </a>
        <span className="text-muted-foreground">
          {mb(main.size)} · version {release.version}
        </span>
      </div>
      <details className="group">
        <summary className="w-fit cursor-pointer text-muted-foreground hover:text-foreground">
          Other versions
        </summary>
        <ul className="mt-2 flex flex-col gap-1.5">
          {release.files.map((f) => (
            <li key={f.abi}>
              <a href={f.url} download className="font-medium underline-offset-4 hover:underline">
                {f.abi}
              </a>{" "}
              <span className="text-muted-foreground">
                {mb(f.size)} · {HINT[f.abi]}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}
