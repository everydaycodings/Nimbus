"use client"

// Browser helpers for /api/v1/secrets.
export const BASE = "/api/v1/secrets"

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public fields?: Record<string, string>
  ) {
    super(message)
  }
}

// JSON in, JSON out. A 423 (locked) tells the shell to show the unlock screen.
export async function api<T = Record<string, never>>(
  path: string,
  method = "GET",
  body?: unknown
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  })
  if (res.ok) return (await res.json()) as T
  const data = (await res.json().catch(() => ({}))) as { message?: string; fields?: Record<string, string> }
  if (res.status === 423) window.dispatchEvent(new Event("secrets-locked"))
  throw new ApiError(data.message ?? "Something went wrong. Try again.", res.status, data.fields)
}

export const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "Something went wrong. Try again."

const CLEAR_MS = 30_000

// Copies, then empties the clipboard after 30 seconds if it still holds this
// text (or if the browser won't let us look, since leaving a secret there is worse).
export async function copySecret(text: string) {
  await navigator.clipboard.writeText(text)
  setTimeout(async () => {
    try {
      if ((await navigator.clipboard.readText()) !== text) return
    } catch {}
    navigator.clipboard.writeText("").catch(() => {})
  }, CLEAR_MS)
}

const SETS = {
  alnum: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
  hex: "0123456789abcdef",
  symbols:
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#%^*-_=+",
}
export type CharSet = keyof typeof SETS

// Random text from the browser's CSPRNG, without modulo bias.
export function generateValue(length: number, set: CharSet = "alnum") {
  const chars = SETS[set]
  const limit = 256 - (256 % chars.length)
  let out = ""
  while (out.length < length) {
    for (const b of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (b < limit && out.length < length) out += chars[b % chars.length]
    }
  }
  return out
}

export function download(name: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// A POST whose answer is a file: saved through the browser. Errors come back as text.
export async function downloadPost(path: string, body: unknown, fallback: string) {
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" })
  if (!res.ok) {
    if (res.status === 423) window.dispatchEvent(new Event("secrets-locked"))
    throw new ApiError(((await res.json().catch(() => ({}))) as { message?: string }).message ?? "Something went wrong. Try again.", res.status)
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? fallback
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
