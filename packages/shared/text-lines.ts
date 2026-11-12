// Shared by vcard.ts and ical.ts: both formats are folded "NAME;PARAM=x:value" lines.

export type Line = { name: string; params: Record<string, string[]>; value: string }
export type FieldChange = { field: string; from: string; to: string }
export type Diff<T> = { added: T[]; removed: T[]; changed: { before: T; after: T; changes: FieldChange[] }[] }

// Joins folded lines (a CRLF plus one space or tab) and quoted-printable soft breaks (a trailing "=").
export function logicalLines(text: string): string[] {
  const raw = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n")
  const out: string[] = []
  for (let i = 0; i < raw.length; i++) {
    let l = raw[i]
    if (/^[^:]*quoted-printable/i.test(l))
      while (l.endsWith("=") && i + 1 < raw.length) l = l.slice(0, -1) + raw[++i]
    if (l.trim()) out.push(l)
  }
  return out
}

const qp = (s: string) => {
  const bytes: number[] = []
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "=" && /^[0-9a-f]{2}$/i.test(s.slice(i + 1, i + 3))) {
      bytes.push(parseInt(s.slice(i + 1, i + 3), 16))
      i += 2
    } else bytes.push(...new TextEncoder().encode(s[i]))
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

// "item1.TEL;TYPE=CELL,VOICE;PREF:+1 555" -> name TEL, params { TYPE: [cell, voice, pref] }. Bare params are types (vCard 2.1).
export function parseLine(l: string): Line | null {
  let inQuote = false
  let colon = -1
  for (let i = 0; i < l.length; i++) {
    if (l[i] === '"') inQuote = !inQuote
    else if (l[i] === ":" && !inQuote) {
      colon = i
      break
    }
  }
  if (colon < 0) return null
  const head: string[] = []
  let cur = ""
  inQuote = false
  for (const ch of l.slice(0, colon)) {
    if (ch === '"') inQuote = !inQuote
    else if (ch === ";" && !inQuote) {
      head.push(cur)
      cur = ""
    } else cur += ch
  }
  head.push(cur)
  const name = head[0].replace(/^[^.]*\./, "").toUpperCase()
  const params: Record<string, string[]> = {}
  for (const p of head.slice(1)) {
    const eq = p.indexOf("=")
    const k = (eq < 0 ? "TYPE" : p.slice(0, eq)).toUpperCase()
    const v = eq < 0 ? p : p.slice(eq + 1)
    ;(params[k] ??= []).push(...v.split(",").map((x) => x.trim().toLowerCase()))
  }
  let value = l.slice(colon + 1)
  if (params.ENCODING?.includes("quoted-printable")) value = qp(value)
  return { name, params, value }
}

// Splits on unescaped `sep`, then unescapes each part (\n \N \, \; \\).
export function splitValue(v: string, sep: string): string[] {
  const parts: string[] = []
  let cur = ""
  for (let i = 0; i < v.length; i++) {
    if (v[i] === "\\" && i + 1 < v.length) {
      const n = v[++i]
      cur += n === "n" || n === "N" ? "\n" : n
    } else if (v[i] === sep) {
      parts.push(cur)
      cur = ""
    } else cur += v[i]
  }
  parts.push(cur)
  return parts
}
export const unescapeText = (v: string) => splitValue(v, "\u0000")[0]
export const escapeText = (v: string) =>
  v.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\;")

// Folds at 75 bytes without splitting a character, CRLF + space between pieces.
export function foldLine(l: string): string {
  const enc = new TextEncoder()
  const out: string[] = []
  let cur = ""
  let bytes = 0
  for (const ch of l) {
    const n = enc.encode(ch).length
    if (bytes + n > (out.length ? 74 : 75)) {
      out.push(cur)
      cur = ""
      bytes = 0
    }
    cur += ch
    bytes += n
  }
  out.push(cur)
  return out.join("\r\n ")
}

// Fields of two items that differ, as text. `fields` maps a label to a comparable string.
export function fieldChanges(a: Record<string, string>, b: Record<string, string>): FieldChange[] {
  return Object.keys(a)
    .filter((f) => a[f] !== b[f])
    .map((field) => ({ field, from: a[field], to: b[field] }))
}

// Matches items by key (a repeated key gets #2, #3), then reports what was added, removed or changed.
export function diffItems<T>(
  a: T[],
  b: T[],
  key: (t: T) => string,
  fields: (t: T) => Record<string, string>
): Diff<T> {
  const index = (list: T[]) => {
    const m = new Map<string, T>()
    for (const t of list) {
      let k = key(t)
      for (let n = 2; m.has(k); n++) k = `${key(t)}#${n}`
      m.set(k, t)
    }
    return m
  }
  const A = index(a)
  const B = index(b)
  const d: Diff<T> = { added: [], removed: [], changed: [] }
  for (const [k, before] of A) {
    const after = B.get(k)
    if (!after) d.removed.push(before)
    else {
      const changes = fieldChanges(fields(before), fields(after))
      if (changes.length) d.changed.push({ before, after, changes })
    }
  }
  for (const [k, after] of B) if (!A.has(k)) d.added.push(after)
  return d
}
