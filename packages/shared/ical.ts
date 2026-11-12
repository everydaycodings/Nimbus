// iCalendar reading and writing (VEVENT only) for the phone's calendar backup (.ics).
import { type Diff, diffItems, escapeText, foldLine, logicalLines, parseLine, unescapeText } from "./text-lines.ts"

export type { Diff, FieldChange } from "./text-lines.ts"

export type CalEvent = {
  uid: string
  /** Set on one changed occurrence of a repeating event. */
  recurrenceId: string
  summary: string
  /** "2025-03-04" (all-day), "2025-03-04T09:00:00" (wall time, in `tzid` or floating) or "2025-03-04T09:00:00Z". */
  start: string
  end: string
  allDay: boolean
  tzid: string
  location: string
  description: string
  /** The RRULE as written, e.g. "FREQ=WEEKLY;BYDAY=MO". */
  rrule: string
}

export const newEvent = (p: Partial<CalEvent> = {}): CalEvent => ({
  uid: "",
  recurrenceId: "",
  summary: "",
  start: "",
  end: "",
  allDay: false,
  tzid: "",
  location: "",
  description: "",
  rrule: "",
  ...p,
})

// 20250304 / 20250304T090000 / ...Z -> the dashed form above.
const parseDate = (v: string) => {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/i.exec(v.trim())
  if (!m) return ""
  const d = `${m[1]}-${m[2]}-${m[3]}`
  return m[4] ? `${d}T${m[4]}:${m[5]}:${m[6] ?? "00"}${m[7] ? "Z" : ""}` : d
}
const icsDate = (s: string) => s.replace(/[-:]/g, "")

// Adds an ISO 8601 duration (P1D, PT1H30M, P1W) to a dashed date.
function addDuration(start: string, dur: string): string {
  const m = /^(-)?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(dur.trim())
  if (!m) return ""
  const sign = m[1] ? -1 : 1
  const ms = ((+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * 86400 + +(m[4] ?? 0) * 3600 + +(m[5] ?? 0) * 60 + +(m[6] ?? 0)) * 1000 * sign
  const z = start.endsWith("Z")
  const t = Date.parse(start.replace(/Z$/, "") + (start.includes("T") ? "" : "T00:00:00") + "Z") + ms
  const iso = new Date(t).toISOString()
  return start.includes("T") ? iso.slice(0, 19) + (z ? "Z" : "") : iso.slice(0, 10)
}

export function parseICal(text: string): CalEvent[] {
  const out: CalEvent[] = []
  let e: CalEvent | null = null
  let duration = ""
  let nested = 0 // inside a VALARM: its DESCRIPTION is not the event's
  for (const raw of logicalLines(text)) {
    const l = parseLine(raw)
    if (!l) continue
    const v = l.value
    if (l.name === "BEGIN") {
      if (v.toUpperCase() === "VEVENT") {
        e = newEvent()
        duration = ""
      } else if (e) nested++
    } else if (l.name === "END") {
      if (v.toUpperCase() === "VEVENT") {
        if (e) {
          if (!e.end && duration) e.end = addDuration(e.start, duration)
          if (!e.uid) e.uid = `${e.summary}@${e.start}`
          out.push(e)
        }
        e = null
      } else if (e && nested) nested--
    } else if (e && !nested) {
      switch (l.name) {
        case "UID":
          e.uid = v.trim()
          break
        case "RECURRENCE-ID":
          e.recurrenceId = parseDate(v)
          break
        case "SUMMARY":
          e.summary = unescapeText(v)
          break
        case "LOCATION":
          e.location = unescapeText(v)
          break
        case "DESCRIPTION":
          e.description = unescapeText(v)
          break
        case "RRULE":
          e.rrule = v.trim()
          break
        case "DURATION":
          duration = v
          break
        case "DTSTART":
          e.start = parseDate(v)
          e.allDay = l.params.VALUE?.includes("date") || !e.start.includes("T")
          e.tzid = l.params.TZID?.[0] ? (raw.match(/TZID=("?)([^;:"]+)\1/i)?.[2] ?? "") : ""
          break
        case "DTEND":
          e.end = parseDate(v)
          break
      }
    }
  }
  return out
}

export function writeICal(events: CalEvent[], now = new Date()): string {
  const stamp = icsDate(now.toISOString().slice(0, 19)) + "Z"
  const out = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Nimbus//Phone backup//EN", "CALSCALE:GREGORIAN"]
  const when = (name: string, e: CalEvent, v: string) => {
    if (e.allDay) return `${name};VALUE=DATE:${icsDate(v.slice(0, 10))}`
    if (e.tzid && !v.endsWith("Z")) return `${name};TZID=${e.tzid}:${icsDate(v)}`
    return `${name}:${icsDate(v)}`
  }
  for (const e of events) {
    out.push("BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${stamp}`)
    if (e.recurrenceId) out.push(when("RECURRENCE-ID", e, e.recurrenceId))
    out.push(when("DTSTART", e, e.start))
    if (e.end) out.push(when("DTEND", e, e.end))
    if (e.rrule) out.push(`RRULE:${e.rrule}`)
    out.push(`SUMMARY:${escapeText(e.summary)}`)
    if (e.location) out.push(`LOCATION:${escapeText(e.location)}`)
    if (e.description) out.push(`DESCRIPTION:${escapeText(e.description)}`)
    out.push("END:VEVENT")
  }
  out.push("END:VCALENDAR")
  return out.map(foldLine).join("\r\n") + "\r\n"
}

/** Same event across two copies: UID plus RECURRENCE-ID. */
export const eventKey = (e: CalEvent) => `${e.uid}${e.recurrenceId ? `|${e.recurrenceId}` : ""}`

// Wall time of a TZID date as UTC ms, by asking Intl for that zone's offset; an unknown zone is read as floating.
function utcMs(local: string, tzid: string): number {
  const wall = Date.parse(local + "Z")
  if (!tzid) return wall
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tzid, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", second: "numeric",
    }).formatToParts(new Date(wall))
    const p = (t: string) => +parts.find((x) => x.type === t)!.value
    return wall - (Date.UTC(p("year"), p("month") - 1, p("day"), p("hour"), p("minute"), p("second")) - wall)
  } catch {
    return wall
  }
}

/** For sorting: when the event starts (UTC ms). All-day events count from midnight. */
export const eventStartMs = (e: CalEvent) =>
  e.start.endsWith("Z") ? Date.parse(e.start) : utcMs(e.start.includes("T") ? e.start : e.start + "T00:00:00", e.allDay ? "" : e.tzid)

const knownZone = (tz: string) => {
  try {
    return Boolean(tz) && Boolean(new Intl.DateTimeFormat("en-US", { timeZone: tz }))
  } catch {
    return false
  }
}

const pad = (n: number) => String(n).padStart(2, "0")
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

/**
 * How to show it: the date to group by and the times. UTC and TZID times show in the viewer's zone, like a
 * calendar app; a floating time (or an unknown zone) shows as written. All-day ends are exclusive in the file, so the last day is one earlier.
 */
export function eventWhen(e: CalEvent): { date: string; time: string; endDate: string; endTime: string } {
  const split = (s: string) => {
    if (!s) return { date: "", time: "" }
    if (s.endsWith("Z") || (s.length > 10 && knownZone(e.tzid))) {
      const d = new Date(s.endsWith("Z") ? Date.parse(s) : utcMs(s, e.tzid))
      return { date: ymd(d), time: hm(d) }
    }
    return { date: s.slice(0, 10), time: s.length > 10 ? s.slice(11, 16) : "" }
  }
  const a = split(e.start)
  const b = split(e.end)
  if (e.allDay) {
    // plain dates, so stepping back a day in UTC is exact
    const back = b.date ? new Date(Date.parse(b.date + "T00:00:00Z") - 86400000).toISOString().slice(0, 10) : ""
    return { date: a.date, time: "", endDate: back > a.date ? back : a.date, endTime: "" }
  }
  return { date: a.date, time: a.time, endDate: b.date || a.date, endTime: b.time }
}

const eventFields = (e: CalEvent): Record<string, string> => ({
  Title: e.summary,
  Starts: e.start,
  Ends: e.end,
  Timezone: e.tzid,
  Place: e.location,
  Notes: e.description,
  Repeats: e.rrule,
})

export const diffEvents = (a: CalEvent[], b: CalEvent[]): Diff<CalEvent> => diffItems(a, b, eventKey, eventFields)
