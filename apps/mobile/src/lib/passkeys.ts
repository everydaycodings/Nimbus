// Passkeys through Android's Credential Manager (native.getPasskey/createPasskey) and Better Auth's
// passkey endpoints. The challenge travels in a cookie, which the app carries by hand like the two-factor one.
import { ApiError, cookiesFrom, send } from "./api"
import { native } from "./native"

// Older APKs lack the native half.
export const passkeysSupported = Boolean(native?.getPasskey && native?.createPasskey)

async function call(server: string, path: string, init: RequestInit & { token?: string } = {}) {
  const r = await send(server, path, init)
  const body = await r.json().catch(() => null)
  if (!r.ok) throw new ApiError(r.status, body?.code ?? "error", body?.message ?? "That didn't work. Try again.")
  return { r, body, cookie: cookiesFrom(r.headers.get("set-cookie")) }
}

const post = (body: object, cookie: string, token?: string): RequestInit & { token?: string } => ({
  method: "POST",
  headers: { cookie },
  token,
  body: JSON.stringify(body),
})

// The session token, or null when the person closed the passkey sheet.
async function finishSignIn(server: string, optionsPath: string, verifyPath: string, cookie0: string, extra: object = {}) {
  const { body: options, cookie } = await call(server, optionsPath, cookie0 ? { method: "POST", headers: { cookie: cookie0 } } : {})
  const response = await native!.getPasskey!(JSON.stringify(options))
  if (!response) return null
  const { r } = await call(server, verifyPath, post({ response: JSON.parse(response), ...extra }, cookie || cookie0))
  const token = r.headers.get("set-auth-token")
  if (!token) throw new Error("The server didn't start a session. Try again.")
  return token
}

export const signInWithPasskey = (server: string) =>
  finishSignIn(server, "/api/auth/passkey/generate-authenticate-options", "/api/auth/passkey/verify-authentication", "")

// The second step of a sign-in that waits at the two-factor screen (`cookie` is its two-factor cookie).
export const passkeyTwoFactor = (server: string, cookie: string) =>
  finishSignIn(server, "/api/auth/two-factor/passkey-options", "/api/auth/two-factor/verify-passkey", cookie)

// Adds a passkey to the signed-in account. False when the person closed the sheet.
export async function addPasskey(server: string, token: string, name: string) {
  const { body: options, cookie } = await call(server, `/api/auth/passkey/generate-register-options?name=${encodeURIComponent(name)}`, { token })
  const response = await native!.createPasskey!(JSON.stringify(options))
  if (!response) return false
  await call(server, "/api/auth/passkey/verify-registration", post({ response: JSON.parse(response), name }, cookie, token))
  return true
}
