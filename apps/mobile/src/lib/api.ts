import type { Instance } from "@nimbus/shared/api"

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

// The server API versions this app can talk to.
const API_MIN = 1
const API_MAX = 1

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
  if (rest.body && !headers.has("content-type"))
    headers.set("content-type", "application/json")
  if (token) headers.set("authorization", `Bearer ${token}`)
  try {
    return await fetch(server + path, { ...rest, headers, credentials: "omit" })
  } catch {
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
    if (instance.apiVersion > API_MAX)
      throw new ApiError(0, "old-app", "This server is newer than this app. Update Nimbus on your phone.")
    if (instance.apiVersion < API_MIN)
      throw new ApiError(0, "old-server", "This server needs an update before this app can use it. Ask whoever runs it.")
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

// Password rejected, code wrong and so on: Better Auth's own messages read fine.
export const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "Something went wrong. Try again."

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
