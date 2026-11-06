import type { Instance } from "@nimbus/shared/api"

import { oldAppText, oldServerText, versionProblem } from "./api-version"
import { setUnreachable } from "./connectivity"
import { logError } from "./error-log"

export type Account = {
  id: string
  server: string
  userId: string
  name: string
  email: string
  image: string | null
  token: string
}

export type { Instance, Me } from "@nimbus/shared/api"

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message)
  }
}

const OFFLINE = "Can't reach the server. Check your connection and try again."

// credentials: "omit" keeps Android's shared cookie jar out of it, so two
// accounts on one server can't overwrite each other's sessions.
export async function send(
  server: string,
  path: string,
  init: RequestInit & { token?: string } = {}
) {
  const { token, ...rest } = init
  const headers = new Headers(rest.headers)
  headers.set("origin", "nimbus://")
  // A form's boundary is set by fetch.
  if (rest.body && !(rest.body instanceof FormData) && !headers.has("content-type"))
    headers.set("content-type", "application/json")
  if (token) headers.set("authorization", `Bearer ${token}`)
  try {
    // A dead network can hang instead of failing; give up on the first byte after 15 s unless the caller manages it.
    const signal = rest.signal ?? (typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(15_000) : undefined)
    const r = await fetch(server + path, { ...rest, signal, headers, credentials: "omit" })
    setUnreachable(false)
    return r
  } catch {
    setUnreachable(true)
    throw new ApiError(0, "offline", OFFLINE)
  }
}

export async function json<T>(
  server: string,
  path: string,
  init: RequestInit & { token?: string } = {}
): Promise<T> {
  const r = await send(server, path, init)
  const body = await r.json().catch(() => null)
  // Server trouble and rate limits (429) go in the diagnostics log; ordinary refusals don't.
  if (!r.ok && (r.status >= 500 || r.status === 429))
    logError("api", `${init.method ?? "GET"} ${path.split("?")[0]} ${r.status} ${body?.message ?? ""}`)
  if (!r.ok)
    throw new ApiError(
      r.status,
      body?.code ?? body?.error ?? "error",
      body?.message ?? "Something went wrong on the server. Try again."
    )
  return body as T
}

// Accepts "files.example.net", with or without a scheme, and finds the Nimbus there.
// With no scheme it tries https first, so http only happens when https can't work.
export async function connect(raw: string) {
  const input = raw.trim().replace(/\/+$/, "")
  if (!input) throw new ApiError(0, "empty", "Enter your server's address.")
  const tries = /^https?:\/\//i.test(input)
    ? [input]
    : [`https://${input}`, `http://${input}`]
  let notNimbus = false
  for (const server of tries) {
    let instance: Instance
    try {
      instance = await json<Instance>(server, "/api/v1/instance")
    } catch (e) {
      if (e instanceof ApiError && e.status !== 0) notNimbus = true
      continue
    }
    if (instance?.app !== "nimbus") {
      notNimbus = true
      continue
    }
    const problem = versionProblem(instance.apiVersion)
    if (problem) throw new ApiError(0, problem, problem === "old-app" ? oldAppText(instance.apiVersion) : oldServerText(instance.apiVersion))
    return { server, instance }
  }
  throw new ApiError(
    0,
    notNimbus ? "not-nimbus" : "offline",
    notNimbus
      ? "That server answered, but it isn't Nimbus, or it needs an update. Check the address."
      : "Can't reach that address. Check it for typos and make sure the server is running."
  )
}

// Set-Cookie headers arrive joined by commas; dates contain commas too, so split
// only where a new name=value starts.
export function cookiesFrom(header: string | null) {
  if (!header) return ""
  return header
    .split(/,(?=\s*[^;=\s]+=)/)
    .map((c) => c.split(";")[0].trim())
    .join("; ")
}

// The session cookie's value is exactly the signed token the bearer plugin takes.
export function tokenFromCookies(cookies: string) {
  const m = /(?:^|[;,]\s*)(?:__Secure-)?[\w.-]*session_token=([^;,\s]+)/.exec(cookies)
  return m ? decodeURIComponent(m[1]) : null
}

// A password or two-factor change replaces the session. The new token comes as
// Better Auth's header, or as the session cookie from a route of ours.
export const newToken = (r: Response) =>
  r.headers.get("set-auth-token") ?? tokenFromCookies(cookiesFrom(r.headers.get("set-cookie")))

// Password rejected, code wrong and so on: Better Auth's own messages read fine.
// Native module rejections ("Call to function 'FileSystem.downloadFileAsync' has been rejected…") are
// logged raw and shown as plain words.
export const errorText = (e: unknown) => {
  const m = e instanceof Error ? e.message : ""
  if (e instanceof ApiError || !/Call to function|Caused by|rejected/.test(m)) return m || "Something went wrong. Try again."
  logError("native", e)
  return /\b404\b/.test(m) ? "This file's contents are missing on the server." : "Couldn't load this file. Check your connection and try again."
}

// A sign-in QR is nimbus://link?server=…&token=…. Null for anything else, so a
// random QR code can't send the app somewhere.
export function parseLink(raw: string) {
  try {
    const u = new URL(raw)
    if (u.protocol !== "nimbus:" || u.host !== "link") return null
    const server = u.searchParams.get("server")
    const token = u.searchParams.get("token")
    if (!server || !token || !/^https?:\/\//.test(server)) return null
    return { server: server.replace(/\/+$/, ""), token }
  } catch {
    return null
  }
}
