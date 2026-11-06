// Push for the Android app: each account's UnifiedPush endpoint (from the Kotlin module) is registered with
// its server, so notifications arrive with the app closed. Kotlin fetches the real text; the push carries none.
// Expo Go has no native module: there the bell is only checked while the app is open.
import Storage from "expo-sqlite/kv-store"
import { Linking, PermissionsAndroid, Platform } from "react-native"

import { json, type Account } from "./api"
import { native } from "./native"

export type Distributor = { id: string; name: string }
export type PushState = { saved: Distributor | null; distributors: Distributor[] }

export const pushAvailable = typeof native?.pushRegister === "function"

export function refreshPush(): PushState {
  const empty: PushState = { saved: null, distributors: [] }
  if (!pushAvailable || typeof native?.pushRefresh !== "function") return empty
  try {
    return JSON.parse(native.pushRefresh()) as PushState
  } catch {
    return empty
  }
}

// What the Notifications screen and the diagnostics say about how notifications get here.
export const liveAvailable = typeof native?.liveSet === "function"
export const liveOn = () => liveAvailable && native?.liveState?.() === true

// Turning it on needs permission to show the "Connected" notification; false when that is refused.
export async function setLive(on: boolean) {
  if (on && !(await allowNotifications())) return false
  native?.liveSet?.(on)
  return true
}

export function pushRoute(state: PushState) {
  if (!pushAvailable) return "Only while the app is open"
  if (liveOn()) return "Instant, built in"
  return state.saved ? `Instant, via ${state.saved.name}` : "Every 15 minutes"
}

export function setDistributor(id: string, accounts: Account[]) {
  native?.pushSetDistributor?.(id)
  return syncPush(accounts)
}

// Idempotent: the server moves a re-registered URL to the caller.
export async function registerEndpoint(account: Account, endpoint: string) {
  await json(account.server, "/api/v1/push", { method: "POST", token: account.token, body: JSON.stringify({ endpoint }) })
}

export async function syncPush(accounts: Account[]) {
  if (!pushAvailable || !refreshPush().saved) return
  for (const a of accounts) {
    const endpoint = native?.pushEndpoint?.(a.id)
    if (!endpoint) native?.pushRegister?.(a.id)
    else await registerEndpoint(a, endpoint).catch(() => {}) // offline or refused: tried again at the next launch
  }
}

// Sign-out: tell the server first, while the token still works.
export async function forgetPush(account: Account) {
  const endpoint = native?.pushEndpoint?.(account.id)
  if (endpoint)
    await json(account.server, "/api/v1/push", { method: "DELETE", token: account.token, body: JSON.stringify({ endpoint }) }).catch(() => {})
  native?.pushUnregister?.(account.id)
}

// ---- Permission to show notifications (Android 13 and up) ----

const POST = "android.permission.POST_NOTIFICATIONS"
export const notificationsAllowed = async () => Platform.OS !== "android" || Platform.Version < 33 || PermissionsAndroid.check(POST as never)

// True once allowed. After a refusal Android won't ask again, so the system settings open instead.
export async function allowNotifications() {
  if (await notificationsAllowed()) return true
  const r = await PermissionsAndroid.request(POST as never).catch(() => null)
  if (r === PermissionsAndroid.RESULTS.GRANTED) return true
  if (r === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) Linking.openSettings().catch(() => {})
  return false
}

// ---- The "install ntfy" card is shown until dismissed ----

const CARD = "push.cardDismissed"
export const cardDismissed = () => Storage.getItemSync(CARD) === "1"
export const dismissCard = () => void Storage.setItem(CARD, "1").catch(() => {})
