// Contacts and calendar backup: when it runs, what the files are called, and how the phone's records
// become the shared Contact and CalEvent. Free of React Native and the Expo modules so a test can run it.
import { newContact, type Contact } from "@nimbus/shared/vcard"
import { newEvent, type CalEvent } from "@nimbus/shared/ical"

export type PhoneType = "contacts" | "calendar"
export const TYPES: PhoneType[] = ["contacts", "calendar"]

export type PhoneSettings = {
  contacts: boolean
  calendar: boolean
  // The account the copies go to; set when the first toggle is turned on.
  accountId: string | null
  // Calendar ids to back up; null is the default choice (see defaultCalendars).
  calendars: string[] | null
  // How many copies to keep; null keeps all of them.
  keep: 3 | 10 | 30 | null
  // The last uploaded file's content hash, and when each type was last brought up to date (or found unchanged).
  hash: Partial<Record<PhoneType, string>>
  lastAt: Partial<Record<PhoneType, number>>
  // The last attempt, so a failing run waits an hour instead of retrying on every app open.
  triedAt: Partial<Record<PhoneType, number>>
}

export const DEFAULT_PHONE: PhoneSettings = { contacts: false, calendar: false, accountId: null, calendars: null, keep: 10, hash: {}, lastAt: {}, triedAt: {} }

const HOUR = 3_600_000
export const DAY = 24 * HOUR

// What's switched on and hasn't been brought up to date for a day.
export const dueTypes = (s: PhoneSettings, now = Date.now()) =>
  TYPES.filter((t) => s[t] && now - (s.lastAt[t] ?? 0) >= DAY && now - (s.triedAt[t] ?? 0) >= HOUR)

// The camera backup's Wi-Fi and charging rules, applied here too. Null means go ahead.
export function gate(rules: { mobileData: boolean; chargingOnly: boolean }, net: { wifi: boolean; connected: boolean }, charging: boolean) {
  if (!net.connected) return "No connection"
  if (!rules.mobileData && !net.wifi) return "Waiting for Wi-Fi"
  if (rules.chargingOnly && !charging) return "Waiting for the charger"
  return null
}

const pad = (n: number) => String(n).padStart(2, "0")

// contacts-2026-11-12.vcf, by the phone's own date: the server counts only these names as copies.
export const backupName = (type: PhoneType, d = new Date()) =>
  `${type}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.${type === "contacts" ? "vcf" : "ics"}`

export type PhoneCalendar = { id: string; title: string; account: string; local: boolean }
export type RawCalendar = { id: string; title: string; isSynced?: boolean; ownerAccount?: string; source?: { name?: string; type?: string; isLocalAccount?: boolean } }

export const mapCalendar = (c: RawCalendar): PhoneCalendar => ({
  id: c.id,
  title: c.title,
  account: c.ownerAccount || c.source?.name || "",
  // Not synced to any account: the phone is the only place these events live.
  local: !c.isSynced || !!c.source?.isLocalAccount || c.source?.type === "local",
})

export const defaultCalendars = (all: PhoneCalendar[]) => all.filter((c) => c.local).map((c) => c.id)
// Calendars that were chosen and still exist.
export const chosenCalendars = (s: PhoneSettings, all: PhoneCalendar[]) => {
  const ids = s.calendars ?? defaultCalendars(all)
  return all.filter((c) => ids.includes(c.id)).map((c) => c.id)
}

// cyrb53: a small, fast, well-spread hash. Only used to notice "same as last time".
export function hashText(text: string) {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

// The file minus the lines that change on every run (the iCalendar stamp).
export const contentHash = (text: string) => hashText(text.replace(/^DTSTAMP:.*\r?\n/gm, ""))

// ---- Contacts ----

export type RawContact = {
  id?: string
  lookupKey?: string
  name?: string
  firstName?: string
  middleName?: string
  lastName?: string
  nickname?: string
  company?: string
  jobTitle?: string
  note?: string
  birthday?: { day: number; month: number; year?: number }
  phoneNumbers?: { label?: string; number?: string }[]
  emails?: { label?: string; email?: string }[]
  urlAddresses?: { url?: string }[]
  addresses?: { label?: string; street?: string; city?: string; region?: string; postalCode?: string; country?: string }[]
}

export function mapContact(r: RawContact, photo: Contact["photo"] = null): Contact {
  const b = r.birthday
  return newContact({
    uid: r.lookupKey || r.id || "",
    name: r.name ?? "",
    given: [r.firstName, r.middleName].filter(Boolean).join(" "),
    family: r.lastName ?? "",
    nickname: r.nickname ?? "",
    org: r.company ?? "",
    title: r.jobTitle ?? "",
    phones: (r.phoneNumbers ?? []).filter((p) => p.number).map((p) => ({ type: p.label ?? "", value: p.number! })),
    emails: (r.emails ?? []).filter((e) => e.email).map((e) => ({ type: e.label ?? "", value: e.email! })),
    urls: (r.urlAddresses ?? []).map((u) => u.url ?? "").filter(Boolean),
    addresses: (r.addresses ?? []).map((a) => ({ type: a.label ?? "", street: a.street ?? "", city: a.city ?? "", region: a.region ?? "", postal: a.postalCode ?? "", country: a.country ?? "" })),
    // Expo's month starts at 0, like a JavaScript Date.
    birthday: b ? `${b.year ? pad4(b.year) : "-"}-${pad(b.month + 1)}-${pad(b.day)}` : "",
    note: r.note ?? "",
    photo,
  })
}
const pad4 = (n: number) => String(n).padStart(4, "0")

// ---- Calendar ----

export type RawEvent = {
  id: string
  title?: string
  startDate: string | Date
  endDate: string | Date
  allDay?: boolean
  timeZone?: string
  location?: string | null
  notes?: string
  recurrenceRule?: { frequency: string; interval?: number; endDate?: string | Date; occurrence?: number } | null
}

const iso = (d: string | Date) => (d instanceof Date ? d : new Date(d)).toISOString()

// An instant as "2025-03-04T09:00:00" on the wall clocks of `tz`; null when the zone isn't known here.
export function wallTime(instant: string, tz: string): string | null {
  try {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
        .formatToParts(new Date(instant))
        .map((x) => [x.type, x.value])
    )
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`
  } catch {
    return null
  }
}

// Android keeps the days of an all-day event as midnight UTC, with the end one day after the last day.
// Android's rule has a frequency, interval and an end (a count or a date); weekdays are not exposed, so a
// weekly event repeats on its start day.
function rrule(r: NonNullable<RawEvent["recurrenceRule"]>, allDay: boolean) {
  const parts = [`FREQ=${r.frequency.toUpperCase()}`]
  if (r.interval && r.interval > 1) parts.push(`INTERVAL=${r.interval}`)
  if (r.occurrence) parts.push(`COUNT=${r.occurrence}`)
  else if (r.endDate) {
    const until = iso(r.endDate).replace(/[-:]/g, "").replace(/\.\d+/, "")
    parts.push(`UNTIL=${allDay ? until.slice(0, 8) : until}`)
  }
  return parts.join(";")
}

export function mapEvent(r: RawEvent): CalEvent {
  const allDay = !!r.allDay
  const s = iso(r.startDate)
  const e = iso(r.endDate)
  const tz = r.timeZone ?? ""
  let start: string
  let end: string
  if (allDay) {
    start = s.slice(0, 10)
    end = e.slice(0, 10)
    if (end <= start) end = new Date(Date.parse(start) + 86_400_000).toISOString().slice(0, 10)
  } else {
    start = (tz && wallTime(s, tz)) || s.slice(0, 19) + "Z"
    end = (tz && wallTime(e, tz)) || e.slice(0, 19) + "Z"
  }
  const zoned = !allDay && !start.endsWith("Z")
  return newEvent({
    uid: `android-${r.id}@nimbus`,
    summary: r.title ?? "",
    start,
    end,
    allDay,
    tzid: zoned ? tz : "",
    location: r.location ?? "",
    description: r.notes ?? "",
    rrule: r.recurrenceRule ? rrule(r.recurrenceRule, allDay) : "",
  })
}
