// Contacts and calendar backup. It makes a .vcf and an .ics from the phone, uploads them into My files → Phone
// backup → <phone>, and tells the server so it can keep the last few. Opening the app and the background task
// (offline-task.ts) both call runDue(); "Back up now" calls runNow().
import type { PhoneBackupDoneResponse, PhoneBackupRegisterResponse, PhoneBackupResponse, PreviewResponse } from "@nimbus/shared/api"
import { writeICal } from "@nimbus/shared/ical"
import { writeVCards, type Contact } from "@nimbus/shared/vcard"
import * as Battery from "expo-battery"
import { File, Paths, Directory } from "expo-file-system"
import * as Network from "expo-network"
import * as Sharing from "expo-sharing"
import Storage from "expo-sqlite/kv-store"
import { useCallback, useState } from "react"
import { Platform } from "react-native"

import { json, type Account } from "./api"
import { readSettings as readCamera } from "./backup"
import { uploadFile } from "./editor-save"
import { fetchTo } from "./file-cache"
import { savedAccounts } from "./offline"
import {
  backupName,
  chosenCalendars,
  contentHash,
  dueTypes,
  gate,
  DEFAULT_PHONE,
  mapCalendar,
  mapContact,
  mapEvent,
  type PhoneCalendar,
  type PhoneSettings,
  type PhoneType,
  type RawCalendar,
  type RawContact,
  type RawEvent,
} from "./phone-backup-rules"
import { awaitDone, knownRows } from "./vault"

const KEY = "phoneBackup.v1"

// The same name device link shows on the Account page.
export const deviceName = () => String((Platform.constants as { Model?: string }).Model ?? "Android phone")

export const readPhone = (): PhoneSettings => {
  try {
    return { ...DEFAULT_PHONE, ...JSON.parse(Storage.getItemSync(KEY) ?? "{}") }
  } catch {
    return DEFAULT_PHONE
  }
}
export function savePhone(change: Partial<PhoneSettings>) {
  const next = { ...readPhone(), ...change }
  // Sync, like readPhone: an async write would let the next read see the old value and undo this change.
  try {
    Storage.setItemSync(KEY, JSON.stringify(next))
  } catch {}
  return next
}

export function usePhoneBackup() {
  const [settings, set] = useState(readPhone)
  const change = useCallback((c: Partial<PhoneSettings>) => set(savePhone(c)), [])
  return { settings, change, reread: () => set(readPhone()) }
}

// ---- Permissions: asked for only when the person turns a type on ----

// The modules load on demand, so a phone that never turns this on never pays for them.
const contactsApi = () => require("expo-contacts/legacy") as typeof import("expo-contacts/legacy")
const calendarApi = () => require("expo-calendar/legacy") as typeof import("expo-calendar/legacy")

export async function askFor(type: PhoneType) {
  try {
    const r = await (type === "contacts" ? contactsApi().requestPermissionsAsync() : calendarApi().requestCalendarPermissionsAsync())
    return r.granted
  } catch {
    return false
  }
}
const allowed = async (type: PhoneType) => {
  try {
    return (await (type === "contacts" ? contactsApi().getPermissionsAsync() : calendarApi().getCalendarPermissionsAsync())).granted
  } catch {
    return false
  }
}

export async function listCalendars(): Promise<PhoneCalendar[]> {
  return (await calendarApi().getCalendarsAsync("event")).map((c) => mapCalendar(c as unknown as RawCalendar))
}

// ---- Reading the phone ----

const base64 = (bytes: Uint8Array) => {
  let s = ""
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

// A contact's photo, or nothing: one photo that won't read shouldn't stop the whole backup.
async function photoOf(uri: string): Promise<Contact["photo"]> {
  try {
    const r = await fetch(uri)
    return { mime: r.headers.get("content-type")?.startsWith("image/") ? r.headers.get("content-type")! : "image/jpeg", base64: base64(new Uint8Array(await r.arrayBuffer())) }
  } catch {
    return null
  }
}

async function contactsFile() {
  const C = contactsApi()
  const { data } = await C.getContactsAsync({
    fields: ["name", "firstName", "middleName", "lastName", "nickname", "company", "jobTitle", "note", "birthday", "phoneNumbers", "emails", "urlAddresses", "addresses", "image"],
  })
  const list: Contact[] = []
  for (const raw of data) list.push(mapContact(raw as unknown as RawContact, raw.image?.uri ? await photoOf(raw.image.uri) : null))
  // A steady order, so the same contacts give the same file.
  list.sort((a, b) => a.uid.localeCompare(b.uid))
  return writeVCards(list)
}

// ponytail: from 2000 to five years ahead. Older events are left out, and a repeating event that began
// before 2000 reads from its true start (getEventAsync) but is missed if it ended before then.
async function calendarFile(ids: string[]) {
  const C = calendarApi()
  const found = ids.length ? await C.getEventsAsync(ids, new Date(2000, 0, 1), new Date(Date.now() + 5 * 365 * 86_400_000)) : []
  // A repeating event comes back once per occurrence; read it once, from the event itself, for its real start.
  const seen = new Set<string>()
  const events: RawEvent[] = []
  for (const e of found) {
    if (seen.has(e.id)) continue
    seen.add(e.id)
    events.push((e.recurrenceRule ? await C.getEventAsync(e.id).catch(() => e) : e) as unknown as RawEvent)
  }
  const mapped = events.map(mapEvent).sort((a, b) => a.uid.localeCompare(b.uid))
  return writeICal(mapped)
}

// ---- Running ----

export type RunResult = { type: PhoneType; state: "uploaded" | "same" | "waiting" | "failed"; text?: string }

const WAIT_MS = 4 * 60_000
const MIME: Record<PhoneType, string> = { contacts: "text/vcard", calendar: "text/calendar" }

async function runOne(a: Account, reg: PhoneBackupRegisterResponse, type: PhoneType): Promise<RunResult> {
  const s = readPhone()
  const text = type === "contacts" ? await contactsFile() : await calendarFile(chosenCalendars(s, await listCalendars()))
  const hash = contentHash(text)
  const finish = async (state: "uploaded" | "same") => {
    await json<PhoneBackupDoneResponse>(a.server, `/api/v1/phone-backup/${reg.id}/done`, { method: "POST", token: a.token, body: JSON.stringify({ type, keep: s.keep }) })
    const now = readPhone()
    savePhone({ hash: { ...now.hash, [type]: hash }, lastAt: { ...now.lastAt, [type]: Date.now() } })
    return { type, state } as RunResult
  }
  // The server is told even when nothing changed, so it knows the backup is current.
  if (s.hash[type] === hash) return finish("same")

  const name = backupName(type)
  const file = new File(Paths.cache, `phone-backup-${Date.now()}-${name}`)
  file.create({ overwrite: true })
  await file.write(text)
  try {
    const known = knownRows()
    await uploadFile(a, reg.folderId, name, file.uri, file.size ?? text.length, MIME[type], "version")
    const done = await Promise.race([awaitDone(a.id, (r) => r.name === name, known, 1), new Promise<null>((r) => setTimeout(() => r(null), WAIT_MS))])
    if (done === null) return { type, state: "waiting", text: "Still uploading. It will be tried again." }
    return done ? await finish("uploaded") : { type, state: "failed", text: "The upload was cancelled." }
  } finally {
    try {
      file.delete()
    } catch {}
  }
}

export async function runTypes(types: PhoneType[], account: Account): Promise<RunResult[]> {
  const out: RunResult[] = []
  const s = readPhone()
  let reg: PhoneBackupRegisterResponse
  try {
    reg = await json<PhoneBackupRegisterResponse>(account.server, "/api/v1/phone-backup", {
      method: "POST",
      token: account.token,
      body: JSON.stringify({ deviceName: deviceName(), contacts: s.contacts, calendar: s.calendar }),
    })
  } catch (e) {
    return types.map((type) => ({ type, state: "failed", text: e instanceof Error ? e.message : "Couldn't reach the server." }))
  }
  for (const type of types) {
    savePhone({ triedAt: { ...readPhone().triedAt, [type]: Date.now() } })
    try {
      out.push(!(await allowed(type)) ? { type, state: "failed", text: `Nimbus can't read your ${type} any more. Allow it in Settings.` } : await runOne(account, reg, type))
    } catch (e) {
      out.push({ type, state: "failed", text: e instanceof Error ? e.message : "Something went wrong." })
    }
  }
  return out
}

const targetAccount = async (s: PhoneSettings) => {
  const all = await savedAccounts()
  return all.find((a) => a.id === s.accountId) ?? null
}

// What stops a scheduled run now: the camera backup's own Wi-Fi and charging rules. Null means go ahead.
async function blocked() {
  const rules = readCamera()
  const [n, state] = await Promise.all([Network.getNetworkStateAsync().catch(() => null), Battery.getBatteryStateAsync().catch(() => Battery.BatteryState.UNKNOWN)])
  return gate(
    rules,
    { connected: !!n && n.isConnected !== false && n.isInternetReachable !== false, wifi: n?.type === Network.NetworkStateType.WIFI || n?.type === Network.NetworkStateType.ETHERNET },
    state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL
  )
}

let running = false

// Called when the app opens and from the background task. Quiet: it only does what's due and allowed.
export async function runDue() {
  if (running) return
  const s = readPhone()
  const types = dueTypes(s)
  if (!types.length) return
  const account = await targetAccount(s)
  if (!account || (await blocked())) return
  running = true
  try {
    await runTypes(types, account)
  } finally {
    running = false
  }
}

// "Back up now": ignores the schedule and the Wi-Fi and charging rules, but still skips what hasn't changed.
export async function runNow(account: Account) {
  if (running) return []
  const s = readPhone()
  running = true
  try {
    return await runTypes((["contacts", "calendar"] as const).filter((t) => s[t]), account)
  } finally {
    running = false
  }
}

// ---- Restore ----

export const phoneCopies = (a: Account) => json<PhoneBackupResponse>(a.server, "/api/v1/phone-backup", { token: a.token })

// Downloads the copy and hands it to Android, which offers Contacts or Calendar to import it.
export async function openCopy(a: Account, copy: { id: string; name: string; type: PhoneType }) {
  const dir = new Directory(Paths.cache, "phone-restore")
  const file = new File(dir, copy.name)
  if (file.exists) file.delete()
  await fetchTo(file, async () => (await json<PreviewResponse>(a.server, `/api/v1/items/${copy.id}/preview`, { token: a.token })).url)
  const mimeType = copy.type === "contacts" ? "text/x-vcard" : "text/calendar"
  if (await file.canPreview({ mimeType }).catch(() => false)) await file.preview({ mimeType, title: copy.name })
  else await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: copy.name })
}
