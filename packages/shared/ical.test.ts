// Run: node --test packages/shared/ical.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import { diffEvents, eventKey, eventStartMs, eventWhen, newEvent, parseICal, writeICal } from "./ical.ts"

const google = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Google Inc//Google Calendar 70.9054//EN",
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Berlin",
  "BEGIN:STANDARD",
  "DTSTART:19701025T030000",
  "TZOFFSETFROM:+0200",
  "END:STANDARD",
  "END:VTIMEZONE",
  "BEGIN:VEVENT",
  "DTSTART;TZID=Europe/Berlin:20250304T090000",
  "DTEND;TZID=Europe/Berlin:20250304T100000",
  "RRULE:FREQ=WEEKLY;BYDAY=TU",
  "UID:abc@google.com",
  "SUMMARY:Stand-up\\, daily",
  "LOCATION:Room 4\; Floor 2",
  "DESCRIPTION:Agenda:\\n1. Status\\n2. Blockers that make this a very long line that has to",
  "  be folded by the exporter",
  "BEGIN:VALARM",
  "TRIGGER:-PT10M",
  "DESCRIPTION:Reminder",
  "ACTION:DISPLAY",
  "END:VALARM",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20250310",
  "DTEND;VALUE=DATE:20250312",
  "UID:allday@google.com",
  "SUMMARY:Conference",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART:20250305T140000Z",
  "DURATION:PT1H30M",
  "UID:utc@android",
  "RECURRENCE-ID:20250305T140000Z",
  "SUMMARY:Call",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n")

test("reads Google events: TZID, alarms skipped, escapes, folding, RRULE as text", () => {
  const [a, b, c] = parseICal(google)
  assert.equal(a.summary, "Stand-up, daily")
  assert.equal(a.location, "Room 4; Floor 2")
  assert.equal(a.start, "2025-03-04T09:00:00")
  assert.equal(a.tzid, "Europe/Berlin")
  assert.equal(a.rrule, "FREQ=WEEKLY;BYDAY=TU")
  assert.match(a.description, /^Agenda:\n1\. Status\n2\. Blockers .* to be folded by the exporter$/)
  assert.ok(!a.description.includes("Reminder"))
  assert.equal(b.allDay, true)
  assert.equal(b.start, "2025-03-10")
  assert.equal(c.end, "2025-03-05T15:30:00Z")
  assert.equal(eventKey(c), "utc@android|2025-03-05T14:00:00Z")
})

test("all-day end is exclusive: a two-day event ends on the 11th", () => {
  const w = eventWhen(parseICal(google)[1])
  assert.deepEqual([w.date, w.endDate, w.time], ["2025-03-10", "2025-03-11", ""])
  const one = eventWhen(newEvent({ start: "2025-03-10", end: "2025-03-11", allDay: true }))
  assert.equal(one.endDate, "2025-03-10")
})

test("TZID times show in the viewer's zone and sort by their real instant", () => {
  const [a] = parseICal(google)
  const w = eventWhen(a)
  const local = (iso: string) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` }
  assert.deepEqual([w.time, w.endTime], [local("2025-03-04T08:00:00Z"), local("2025-03-04T09:00:00Z")])
  // Berlin is UTC+1 in March
  assert.equal(new Date(eventStartMs(a)).toISOString(), "2025-03-04T08:00:00.000Z")
  // Unknown zone name: read as floating
  const odd = newEvent({ start: "2025-03-04T09:00:00", tzid: "Customized Time Zone" })
  assert.equal(new Date(eventStartMs(odd)).toISOString(), "2025-03-04T09:00:00.000Z")
  assert.equal(eventWhen(odd).time, "09:00")
})

test("write then read gives the same events", () => {
  const events = parseICal(google).map((e) => ({ ...e }))
  const text = writeICal(events, new Date("2025-01-01T00:00:00Z"))
  assert.match(text, /DTSTAMP:20250101T000000Z/)
  for (const l of text.split("\r\n")) assert.ok(new TextEncoder().encode(l).length <= 75)
  assert.deepEqual(parseICal(text), events)
})

test("a name with no UID still gets an identity", () => {
  const [e] = parseICal("BEGIN:VEVENT\nDTSTART:20250101T100000\nSUMMARY:Lunch\nEND:VEVENT")
  assert.equal(e.uid, "Lunch@2025-01-01T10:00:00")
})

test("diff: added, removed, changed with fields", () => {
  const [a, b, c] = parseICal(google)
  const moved = { ...a, start: "2025-03-04T10:00:00", location: "Room 5", rrule: "" }
  const extra = newEvent({ uid: "new", summary: "New", start: "2025-04-01" })
  const d = diffEvents([a, b], [moved, c, extra])
  assert.deepEqual(d.removed.map((e) => e.uid), ["allday@google.com"])
  assert.deepEqual(d.added.map((e) => e.uid), ["utc@android", "new"])
  assert.deepEqual(d.changed[0].changes.map((x) => x.field), ["Starts", "Place", "Repeats"])
  assert.deepEqual(diffEvents([a], [{ ...a }]).changed, [])
})
