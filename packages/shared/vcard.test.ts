// Run: node --test packages/shared/vcard.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import { contactKey, diffContacts, newContact, parseVCards, writeVCard, writeVCards } from "./vcard.ts"

const PHOTO = "/9j/4AAQSkZJRgABAQ" + "A".repeat(200)

const google = [
  "BEGIN:VCARD",
  "VERSION:3.0",
  "FN:Ada Lovelace",
  "N:Lovelace;Ada;;;",
  "ORG:Analytical Engines\\, Ltd.;Research",
  "TITLE:Countess",
  "item1.TEL;TYPE=CELL,VOICE,pref:+44 20 7946 0000",
  "TEL;TYPE=WORK:+44 20 7946 1111",
  "EMAIL;TYPE=INTERNET;TYPE=HOME:ada@example.com",
  "ADR;TYPE=HOME:;;12 St James's Sq;London;;SW1Y 4JH;UK",
  "BDAY:1815-12-10",
  "NOTE:Line one\\nLine two\; with semicolon",
  "PHOTO;ENCODING=b;TYPE=JPEG:" + PHOTO.slice(0, 40),
  " " + PHOTO.slice(40, 120),
  " " + PHOTO.slice(120),
  "END:VCARD",
  "",
].join("\r\n")

test("reads a Google export: groups, types, escapes, folded photo", () => {
  const [c] = parseVCards(google)
  assert.equal(c.name, "Ada Lovelace")
  assert.equal(c.org, "Analytical Engines, Ltd., Research")
  assert.deepEqual(c.phones, [
    { type: "cell", value: "+44 20 7946 0000" },
    { type: "work", value: "+44 20 7946 1111" },
  ])
  assert.deepEqual(c.emails, [{ type: "home", value: "ada@example.com" }])
  assert.equal(c.addresses[0].street, "12 St James's Sq")
  assert.equal(c.addresses[0].postal, "SW1Y 4JH")
  assert.equal(c.birthday, "1815-12-10")
  assert.equal(c.note, "Line one\nLine two; with semicolon")
  assert.deepEqual(c.photo, { mime: "image/jpeg", base64: PHOTO })
})

test("reads an Android 2.1 card: quoted-printable UTF-8 with soft breaks, bare types", () => {
  const [c] = parseVCards(
    [
      "BEGIN:VCARD",
      "VERSION:2.1",
      "N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:M=C3=BCller;J=C3=B6rg;;;",
      "FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:J=C3=B6rg M=C3=BC=",
      "ller",
      "TEL;CELL:0171 1234567",
      "END:VCARD",
    ].join("\n")
  )
  assert.equal(c.name, "Jörg Müller")
  assert.equal(c.family, "Müller")
  assert.equal(c.phones[0].type, "cell")
})

test("reads a 4.0 card with data-URI photo and no FN", () => {
  const [c] = parseVCards(
    "BEGIN:VCARD\nVERSION:4.0\nN:Doe;Jane;;;\nTEL;VALUE=uri;TYPE=\"cell,voice\":tel:+1-555-0100\nPHOTO:data:image/png;base64,iVBORw0KGgo=\nUID:urn:uuid:abc-123\nEND:VCARD"
  )
  assert.equal(c.name, "Jane Doe")
  assert.equal(c.uid, "abc-123")
  assert.equal(c.phones[0].value, "+1-555-0100")
  assert.deepEqual(c.photo, { mime: "image/png", base64: "iVBORw0KGgo=" })
})

test("reads several cards and ignores junk lines", () => {
  const all = parseVCards(google + "\r\ngarbage\r\n" + google.replace("Ada", "Bob"))
  assert.deepEqual(all.map((c) => c.name), ["Ada Lovelace", "Bob Lovelace"])
})

test("writes vCard 3.0 that reads back the same, with folded lines under 76 bytes", () => {
  const original = parseVCards(google)
  const text = writeVCards(original)
  assert.match(text, /^BEGIN:VCARD\r\nVERSION:3\.0\r\n/)
  for (const l of text.split("\r\n")) assert.ok(new TextEncoder().encode(l).length <= 75)
  const back = parseVCards(text)
  assert.deepEqual(back, original)
})

test("round trip keeps commas, semicolons, newlines and non-ASCII", () => {
  const c = newContact({ name: "Zoë; \"Z\", Ñ", given: "Zoë", note: "a,b;c\nd\\e " + "é".repeat(100), phones: [{ type: "", value: "1" }] })
  assert.deepEqual(parseVCards(writeVCard(c))[0], c)
})

test("identity: UID, else name plus first phone digits", () => {
  assert.equal(contactKey(newContact({ uid: "u1", name: "A" })), "uid:u1")
  const a = newContact({ name: "Ann Lee", phones: [{ type: "cell", value: "+1 (555) 010-0" }] })
  const b = newContact({ name: "ann lee", phones: [{ type: "", value: "+15550100" }] })
  assert.equal(contactKey(a), contactKey(b))
  assert.equal(contactKey(newContact({ name: "X", emails: [{ type: "", value: "A@B.c" }] })), "n:x|a@b.c")
})

test("diff: added, removed, and field-level changes", () => {
  const ann = newContact({ uid: "1", name: "Ann", phones: [{ type: "cell", value: "111" }], note: "hi" })
  const bob = newContact({ name: "Bob", phones: [{ type: "", value: "222" }] })
  const cy = newContact({ name: "Cy", emails: [{ type: "", value: "cy@x.io" }] })
  const ann2 = { ...ann, name: "Ann Lee", phones: [{ type: "cell", value: "111" }, { type: "work", value: "333" }], photo: { mime: "image/png", base64: "AAAA" } }
  const d = diffContacts([ann, bob], [ann2, cy])
  assert.deepEqual(d.removed.map((c) => c.name), ["Bob"])
  assert.deepEqual(d.added.map((c) => c.name), ["Cy"])
  assert.equal(d.changed.length, 1)
  const fields = Object.fromEntries(d.changed[0].changes.map((c) => [c.field, c]))
  assert.deepEqual(Object.keys(fields).sort(), ["Name", "Phones", "Photo"])
  assert.equal(fields.Name.to, "Ann Lee")
  assert.equal(fields.Photo.from, "")
  assert.equal(fields.Photo.to, "a photo")
  assert.deepEqual(diffContacts([ann], [{ ...ann }]).changed, [])
})

test("diff copes with duplicate keys", () => {
  const a = newContact({ name: "Same" })
  const d = diffContacts([a, a], [a])
  assert.equal(d.removed.length, 1)
})
