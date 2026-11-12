// Passkey rules, kept pure for tests (passkey-rules.test.ts).

// The relying-party id for a server URL, or null when passkeys can't work there:
// browsers and Android want https and a real domain name, not an IP address.
// localhost is allowed so they can be tried in development.
export function passkeyHost(baseUrl: string | undefined) {
  let u: URL
  try {
    u = new URL(baseUrl ?? "")
  } catch {
    return null
  }
  if (u.hostname === "localhost") return "localhost"
  const ip = /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) || u.hostname.includes(":")
  return u.protocol === "https:" && !ip && u.hostname.includes(".")
    ? u.hostname
    : null
}

// The origin Android reports for an app signed with this certificate
// ("AA:BB:…" SHA-256 hex, as keytool prints it). Null when it isn't one.
export function apkOrigin(sha256: string | undefined) {
  const hex = (sha256 ?? "").replaceAll(":", "").trim()
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return null
  return `android:apk-key-hash:${Buffer.from(hex, "hex").toString("base64url")}`
}

// Android Studio's fixed debug certificate, which the app is built with in development.
export const DEBUG_SHA256 =
  "FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C"

// The app's id (apps/mobile/app.json), which assetlinks.json names.
export const ANDROID_PACKAGE = "org.nimbus.drive"
