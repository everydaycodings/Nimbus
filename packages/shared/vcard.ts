// vCard 2.1/3.0/4.0 reading and vCard 3.0 writing for the phone's contacts backup (.vcf).
import {
  type Diff,
  diffItems,
  escapeText,
  foldLine,
  logicalLines,
  parseLine,
  splitValue,
} from "./text-lines.ts"

export type { Diff, FieldChange } from "./text-lines.ts"

export type Labelled = { type: string; value: string }
export type Address = {
  type: string
  street: string
  city: string
  region: string
  postal: string
  country: string
}
export type Contact = {
  uid: string
  /** Display name (FN, or built from N). */
  name: string
  given: string
  family: string
  nickname: string
  org: string
  title: string
  phones: Labelled[]
  emails: Labelled[]
  urls: string[]
  addresses: Address[]
  /** YYYY-MM-DD, or --MM-DD when the year is unknown. */
  birthday: string
  note: string
  /** Embedded photo; a photo given by URL is dropped. */
  photo: { mime: string; base64: string } | null
}

export const newContact = (p: Partial<Contact> = {}): Contact => ({
  uid: "",
  name: "",
  given: "",
  family: "",
  nickname: "",
  org: "",
  title: "",
  phones: [],
  emails: [],
  urls: [],
  addresses: [],
  birthday: "",
  note: "",
  photo: null,
  ...p,
})

const NOISE = new Set(["pref", "voice", "internet", "text", "x-pref"])
const typeOf = (types: string[] = []) =>
  types.map((t) => t.replace(/^x-/, "")).find((t) => !NOISE.has(t)) ?? ""

const bday = (v: string) => {
  const d = v.replace(/-/g, "").replace(/T.*/, "")
  if (/^\d{8}$/.test(d)) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`
  if (/^\d{4}$/.test(d) && v.startsWith("--")) return `--${d.slice(0, 2)}-${d.slice(2)}`
  return v.trim()
}

export function parseVCards(text: string): Contact[] {
  const out: Contact[] = []
  let c: Contact | null = null
  for (const raw of logicalLines(text)) {
    const l = parseLine(raw)
    if (!l) continue
    if (l.name === "BEGIN" && l.value.toUpperCase() === "VCARD") c = newContact()
    else if (l.name === "END" && l.value.toUpperCase() === "VCARD") {
      if (c) {
        if (!c.name) c.name = [c.given, c.family].filter(Boolean).join(" ") || c.org
        out.push(c)
      }
      c = null
    } else if (c) {
      const v = l.value
      switch (l.name) {
        case "UID":
          c.uid = v.trim().replace(/^urn:uuid:/i, "")
          break
        case "FN":
          c.name = splitValue(v, "\u0000")[0].trim()
          break
        case "N": {
          const [family = "", given = ""] = splitValue(v, ";")
          c.family = family.trim()
          c.given = given.trim()
          break
        }
        case "NICKNAME":
          c.nickname = splitValue(v, "\u0000")[0]
          break
        case "ORG":
          c.org = splitValue(v, ";").filter(Boolean).join(", ")
          break
        case "TITLE":
          c.title = splitValue(v, "\u0000")[0]
          break
        case "TEL":
          c.phones.push({ type: typeOf(l.params.TYPE), value: v.replace(/^tel:/i, "").trim() })
          break
        case "EMAIL":
          c.emails.push({ type: typeOf(l.params.TYPE), value: splitValue(v, "\u0000")[0].trim() })
          break
        case "URL":
          c.urls.push(splitValue(v, "\u0000")[0].trim())
          break
        case "ADR": {
          const [, , street = "", city = "", region = "", postal = "", country = ""] = splitValue(v, ";")
          c.addresses.push({ type: typeOf(l.params.TYPE), street, city, region, postal, country })
          break
        }
        case "BDAY":
          c.birthday = bday(v)
          break
        case "NOTE":
          c.note = splitValue(v, "\u0000")[0]
          break
        case "PHOTO": {
          const data = /^data:([^;,]+);base64,([\s\S]*)$/i.exec(v)
          if (data) c.photo = { mime: data[1], base64: data[2].replace(/\s/g, "") }
          else if (l.params.ENCODING?.some((e) => e === "b" || e === "base64")) {
            const t = (l.params.TYPE ?? []).find((x) => x !== "base64" && x !== "b") ?? "jpeg"
            c.photo = { mime: t.includes("/") ? t : `image/${t === "jpg" ? "jpeg" : t}`, base64: v.replace(/\s/g, "") }
          }
          break
        }
      }
    }
  }
  return out
}

const line = (name: string, value: string, params = "") => foldLine(`${name}${params}:${value}`)

export function writeVCard(c: Contact): string {
  const out = ["BEGIN:VCARD", "VERSION:3.0"]
  if (c.uid) out.push(line("UID", c.uid))
  out.push(line("FN", escapeText(c.name || [c.given, c.family].filter(Boolean).join(" "))))
  out.push(line("N", `${escapeText(c.family)};${escapeText(c.given)};;;`))
  if (c.nickname) out.push(line("NICKNAME", escapeText(c.nickname)))
  if (c.org) out.push(line("ORG", escapeText(c.org)))
  if (c.title) out.push(line("TITLE", escapeText(c.title)))
  const t = (type: string) => (type ? `;TYPE=${type.toUpperCase()}` : "")
  for (const p of c.phones) out.push(line("TEL", p.value, t(p.type)))
  for (const e of c.emails) out.push(line("EMAIL", e.value, t(e.type)))
  for (const a of c.addresses)
    out.push(
      line("ADR", ["", "", a.street, a.city, a.region, a.postal, a.country].map(escapeText).join(";"), t(a.type))
    )
  for (const u of c.urls) out.push(line("URL", u))
  if (c.birthday) out.push(line("BDAY", c.birthday))
  if (c.note) out.push(line("NOTE", escapeText(c.note)))
  if (c.photo)
    out.push(line("PHOTO", c.photo.base64, `;ENCODING=b;TYPE=${c.photo.mime.replace(/^image\//, "").toUpperCase()}`))
  out.push("END:VCARD")
  return out.join("\r\n") + "\r\n"
}

export const writeVCards = (list: Contact[]) => list.map(writeVCard).join("")

/** Same person across two copies: the UID, else name plus first phone digits (or email). */
export function contactKey(c: Contact): string {
  if (c.uid) return `uid:${c.uid}`
  const p = c.phones[0]?.value.replace(/\D/g, "") || c.emails[0]?.value.toLowerCase() || ""
  return `n:${c.name.trim().toLowerCase()}|${p}`
}

const addr = (a: Address) =>
  [a.street, a.city, a.region, a.postal, a.country].filter(Boolean).join(", ")
const labelled = (l: Labelled[]) => l.map((x) => `${x.value}${x.type ? ` (${x.type})` : ""}`).sort().join("\n")

const contactFields = (c: Contact): Record<string, string> => ({
  Name: c.name,
  Nickname: c.nickname,
  Organisation: c.org,
  "Job title": c.title,
  Phones: labelled(c.phones),
  Emails: labelled(c.emails),
  Addresses: c.addresses.map((a) => `${addr(a)}${a.type ? ` (${a.type})` : ""}`).sort().join("\n"),
  Websites: [...c.urls].sort().join("\n"),
  Birthday: c.birthday,
  Notes: c.note,
  Photo: c.photo ? `${c.photo.base64.length}:${c.photo.base64.slice(0, 64)}` : "",
})

/** What changed between two copies. Photo changes show as "Photo": "" or "a photo". */
export function diffContacts(a: Contact[], b: Contact[]): Diff<Contact> {
  const d = diffItems(a, b, contactKey, contactFields)
  for (const ch of d.changed)
    for (const f of ch.changes)
      if (f.field === "Photo") {
        f.from = f.from ? "a photo" : ""
        f.to = f.to ? "a photo" : ""
      }
  return d
}
