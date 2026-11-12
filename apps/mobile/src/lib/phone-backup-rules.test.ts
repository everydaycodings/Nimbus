import assert from "node:assert/strict"
import { test } from "node:test"

import { writeICal } from "@nimbus/shared/ical"
import { backupName, chosenCalendars, contentHash, DAY, DEFAULT_PHONE, defaultCalendars, dueTypes, gate, mapCalendar, mapContact, mapEvent } from "./phone-backup-rules.ts"

const on = { ...DEFAULT_PHONE, contacts: true, calendar: true }

test("only what's on and a day old is due; a failed try waits an hour", () => {
  const now = 10 * DAY
  assert.deepEqual(dueTypes(DEFAULT_PHONE, now), [])
  assert.deepEqual(dueTypes(on, now), ["contacts", "calendar"])
  assert.deepEqual(dueTypes({ ...on, lastAt: { contacts: now - DAY + 1 } }, now), ["calendar"])
  assert.deepEqual(dueTypes({ ...on, triedAt: { calendar: now - 60_000 } }, now), ["contacts"])
})

test("Wi-Fi and charging rules", () => {
  const net = { wifi: false, connected: true }
  assert.equal(gate({ mobileData: false, chargingOnly: false }, net, false), "Waiting for Wi-Fi")
  assert.equal(gate({ mobileData: true, chargingOnly: false }, net, false), null)
  assert.equal(gate({ mobileData: true, chargingOnly: true }, net, false), "Waiting for the charger")
  assert.equal(gate({ mobileData: true, chargingOnly: true }, net, true), null)
  assert.equal(gate({ mobileData: true, chargingOnly: false }, { wifi: false, connected: false }, true), "No connection")
})

test("file names use the local date", () => {
  assert.equal(backupName("contacts", new Date(2026, 10, 2, 23, 59)), "contacts-2026-11-02.vcf")
  assert.equal(backupName("calendar", new Date(2026, 0, 15)), "calendar-2026-01-15.ics")
})

test("local calendars are ticked by default, and a saved choice drops calendars that are gone", () => {
  const all = [
    { id: "1", title: "Phone", isSynced: false },
    { id: "2", title: "Work", isSynced: true, ownerAccount: "me@example.com", source: { type: "caldav", name: "me@example.com" } },
    { id: "3", title: "Device", isSynced: true, source: { type: "local", isLocalAccount: true } },
  ].map(mapCalendar)
  assert.deepEqual(defaultCalendars(all), ["1", "3"])
  assert.deepEqual(chosenCalendars(DEFAULT_PHONE, all), ["1", "3"])
  assert.deepEqual(chosenCalendars({ ...DEFAULT_PHONE, calendars: ["2", "9"] }, all), ["2"])
})

test("the hash ignores the iCalendar stamp but not the content", () => {
  const ev = mapEvent({ id: "1", title: "Lunch", startDate: "2026-03-04T12:00:00.000Z", endDate: "2026-03-04T13:00:00.000Z" })
  const a = writeICal([ev], new Date("2026-01-01T00:00:00Z"))
  const b = writeICal([ev], new Date("2026-02-02T00:00:00Z"))
  assert.notEqual(a, b)
  assert.equal(contentHash(a), contentHash(b))
  assert.notEqual(contentHash(a), contentHash(writeICal([{ ...ev, summary: "Dinner" }])))
})

test("a contact keeps its labels, birthday and photo", () => {
  const c = mapContact(
    {
      id: "7",
      lookupKey: "abc",
      name: "Ada Lovelace",
      firstName: "Ada",
      lastName: "Lovelace",
      company: "Analytical",
      birthday: { day: 10, month: 11, year: 1815 },
      phoneNumbers: [{ label: "mobile", number: "+1 555 0100" }, { label: "home" }],
      emails: [{ label: "work", email: "ada@example.com" }],
      addresses: [{ label: "home", street: "1 St", city: "London", postalCode: "N1" }],
    },
    { mime: "image/jpeg", base64: "AAAA" }
  )
  assert.equal(c.uid, "abc")
  assert.equal(c.birthday, "1815-12-10")
  assert.deepEqual(c.phones, [{ type: "mobile", value: "+1 555 0100" }])
  assert.equal(c.addresses[0].postal, "N1")
  assert.equal(c.photo?.base64, "AAAA")
  assert.equal(mapContact({ id: "8", birthday: { day: 3, month: 0 } }).birthday, "--01-03")
})

test("an all-day event is dates, and its end is the day after", () => {
  const e = mapEvent({ id: "2", title: "Holiday", allDay: true, startDate: "2026-12-25T00:00:00.000Z", endDate: "2026-12-26T00:00:00.000Z", timeZone: "UTC" })
  assert.deepEqual([e.start, e.end, e.allDay, e.tzid], ["2026-12-25", "2026-12-26", true, ""])
  assert.equal(mapEvent({ id: "3", allDay: true, startDate: "2026-12-25T00:00:00.000Z", endDate: "2026-12-25T00:00:00.000Z" }).end, "2026-12-26")
})

test("a timed event is wall time in its own zone, across daylight saving", () => {
  const winter = mapEvent({ id: "4", title: "Call", startDate: "2026-01-15T14:00:00.000Z", endDate: "2026-01-15T15:00:00.000Z", timeZone: "America/New_York" })
  assert.deepEqual([winter.start, winter.end, winter.tzid], ["2026-01-15T09:00:00", "2026-01-15T10:00:00", "America/New_York"])
  const summer = mapEvent({ id: "5", startDate: "2026-07-15T14:00:00.000Z", endDate: "2026-07-15T15:00:00.000Z", timeZone: "America/New_York" })
  assert.equal(summer.start, "2026-07-15T10:00:00")
  // Midnight must read 00, not 24.
  assert.equal(mapEvent({ id: "6", startDate: "2026-01-15T05:00:00.000Z", endDate: "2026-01-15T06:00:00.000Z", timeZone: "America/New_York" }).start, "2026-01-15T00:00:00")
})

test("an unknown zone falls back to UTC", () => {
  const e = mapEvent({ id: "7", startDate: "2026-01-15T14:00:00.000Z", endDate: "2026-01-15T15:00:00.000Z", timeZone: "Nowhere/Land" })
  assert.deepEqual([e.start, e.tzid], ["2026-01-15T14:00:00Z", ""])
})

test("repeat rules become an RRULE", () => {
  const base = { id: "8", startDate: "2026-01-15T14:00:00.000Z", endDate: "2026-01-15T15:00:00.000Z" }
  assert.equal(mapEvent({ ...base, recurrenceRule: { frequency: "weekly", interval: 2, occurrence: 5 } }).rrule, "FREQ=WEEKLY;INTERVAL=2;COUNT=5")
  assert.equal(mapEvent({ ...base, recurrenceRule: { frequency: "daily", endDate: "2026-02-01T14:00:00.000Z" } }).rrule, "FREQ=DAILY;UNTIL=20260201T140000Z")
  assert.equal(mapEvent({ ...base, allDay: true, recurrenceRule: { frequency: "yearly", endDate: "2030-02-01T00:00:00.000Z" } }).rrule, "FREQ=YEARLY;UNTIL=20300201")
  assert.equal(mapEvent(base).rrule, "")
})
