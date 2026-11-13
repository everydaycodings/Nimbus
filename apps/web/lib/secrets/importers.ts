// Imports from other tools: Infisical (JSON, CSV), Doppler (JSON), 1Password (.1pux data,
// CSV), Bitwarden (unencrypted JSON, CSV) and KeePass (XML export). Env-style keys become
// secrets; logins, API credentials and notes become Items. Pure (relative imports only);
// the route unzips a .1pux and hands over its export.data text.
import { KEY_RE } from "./consts.ts"

export const TOOLS = ["infisical", "doppler", "1password", "bitwarden", "keepass"] as const
export type Tool = (typeof TOOLS)[number]
export type Pair = { key: string; value: string }
export type Entry = { kind: "login" | "api_key" | "note"; name: string; data: Record<string, string> }
export type Imported = { pairs: Pair[]; entries: Entry[]; errors: string[] }

const empty = (): Imported => ({ pairs: [], entries: [], errors: [] })

// RFC 4180: quoted fields, doubled quotes, newlines inside quotes.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false
  const src = text.replace(/^﻿/, "")
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ",") {
      row.push(cell)
      cell = ""
    }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++
      row.push(cell)
      cell = ""
      if (row.some((c) => c !== "")) rows.push(row)
      row = []
    } else cell += ch
  }
  row.push(cell)
  if (row.some((c) => c !== "")) rows.push(row)
  return rows
}

const csvObjects = (text: string) => {
  const [head, ...rest] = parseCsv(text)
  if (!head) return []
  const names = head.map((h) => h.trim().toLowerCase())
  return rest.map((r) => Object.fromEntries(names.map((n, i) => [n, r[i] ?? ""])))
}
const pick = (o: Record<string, string>, ...names: string[]) => names.map((n) => o[n]).find((v) => v) ?? ""

function addPair(out: Imported, key: unknown, value: unknown) {
  const k = String(key ?? "").trim()
  if (!KEY_RE.test(k)) return void out.errors.push(`Skipped “${k.slice(0, 40)}”: not a valid key name (letters, digits, underscore).`)
  out.pairs.push({ key: k, value: value == null ? "" : typeof value === "string" ? value : JSON.stringify(value) })
}

function json(text: string, what: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`That isn't a valid ${what} file (JSON could not be read).`)
  }
}

// ---- Infisical, Doppler -----------------------------------------------------

function infisical(text: string, name = ""): Imported {
  const out = empty()
  let rows: Record<string, unknown>[]
  if (/\.csv$/i.test(name) || /^\s*(key|secret ?key)\s*,/i.test(text)) {
    rows = csvObjects(text).map((o) => ({ key: pick(o, "key", "secret key", "secretkey", "name"), value: pick(o, "value", "secret value", "secretvalue"), environment: o.environment }))
  } else {
    const j = json(text, "Infisical") as unknown
    rows = Array.isArray(j) ? j : Array.isArray((j as { secrets?: unknown })?.secrets) ? (j as { secrets: Record<string, unknown>[] }).secrets : []
    if (!rows.length) throw new Error("No secrets found. Export from Infisical as JSON or CSV.")
  }
  const envs = new Set(rows.map((r) => String(r.environment ?? r.env ?? "")).filter(Boolean))
  if (envs.size > 1) out.errors.push(`The export holds ${envs.size} environments (${[...envs].join(", ")}). All are read into this one; later rows win.`)
  for (const r of rows) addPair(out, r.key ?? r.secretKey, r.value ?? r.secretValue)
  return out
}

function doppler(text: string): Imported {
  const out = empty()
  const j = json(text, "Doppler") as Record<string, unknown>
  if (!j || typeof j !== "object" || Array.isArray(j)) throw new Error("That isn't a Doppler download. Use `doppler secrets download --format json`.")
  const src = (j.secrets && typeof j.secrets === "object" ? j.secrets : j) as Record<string, unknown>
  for (const [k, v] of Object.entries(src)) {
    if (k.startsWith("DOPPLER_")) continue
    // The API's shape wraps each value as { raw, computed }.
    const val = v && typeof v === "object" && ("computed" in v || "raw" in v) ? ((v as { computed?: unknown; raw?: unknown }).computed ?? (v as { raw?: unknown }).raw) : v
    addPair(out, k, val)
  }
  return out
}

// ---- Logins and notes -------------------------------------------------------

type Raw = { title: string; username?: string; password?: string; url?: string; totp?: string; notes?: string; kind?: "login" | "note" | "api_key" }

// An env-style title with just a secret value is a secret, not an item.
const ENV_TITLE = /^[A-Z][A-Z0-9_]{2,}$/

function add(out: Imported, r: Raw) {
  const title = r.title.trim().slice(0, 80) || "Untitled"
  const secretValue = r.password || ""
  const kind = r.kind ?? (r.username || r.password || r.url || r.totp ? "login" : "note")
  if (ENV_TITLE.test(title) && !r.username && !r.url && (secretValue || r.notes)) return addPair(out, title, secretValue || r.notes)
  if (kind === "note") return void out.entries.push({ kind: "note", name: title, data: { body: [r.notes, secretValue].filter(Boolean).join("\n") } })
  if (kind === "api_key") return void out.entries.push({ kind: "api_key", name: title, data: { provider: r.url ?? "", token: secretValue, scopes: "", notes: r.notes ?? "" } })
  out.entries.push({ kind: "login", name: title, data: { username: r.username ?? "", password: secretValue, url: r.url ?? "", totp: r.totp ?? "", notes: r.notes ?? "" } })
}

function loginsCsv(text: string): Imported {
  const out = empty()
  for (const o of csvObjects(text)) {
    const type = pick(o, "type", "category").toLowerCase()
    add(out, {
      title: pick(o, "title", "name"),
      username: pick(o, "username", "login_username", "user name", "login username"),
      password: pick(o, "password", "login_password"),
      url: pick(o, "website", "url", "login_uri", "login url", "web site"),
      totp: pick(o, "otpauth", "totp", "login_totp", "one-time password"),
      notes: pick(o, "notes", "note", "notesplain"),
      kind: /note/.test(type) && !pick(o, "password", "login_password") ? "note" : undefined,
    })
  }
  return out
}

function bitwarden(text: string, name = ""): Imported {
  if (/\.csv$/i.test(name)) return loginsCsv(text)
  const j = json(text, "Bitwarden") as { encrypted?: boolean; items?: Record<string, unknown>[] }
  if (j?.encrypted) throw new Error("That Bitwarden export is encrypted. Export again as “.json” without a password.")
  if (!Array.isArray(j?.items)) throw new Error("No items found. Export from Bitwarden as JSON.")
  const out = empty()
  for (const i of j.items) {
    const title = String(i.name ?? "")
    const login = (i.login ?? {}) as { username?: string; password?: string; totp?: string; uris?: { uri?: string }[] }
    const extra = ((i.fields as { name?: string; value?: string }[] | undefined) ?? []).map((f) => `${f.name}: ${f.value}`)
    const notes = [i.notes as string | null, ...extra].filter(Boolean).join("\n")
    if (i.type === 1)
      add(out, { title, username: login.username ?? "", password: login.password ?? "", url: login.uris?.[0]?.uri ?? "", totp: login.totp ?? "", notes, kind: "login" })
    else if (i.type === 2) add(out, { title, notes, kind: "note" })
    else out.errors.push(`Skipped “${title}”: ${i.type === 3 ? "cards" : "identities"} aren't imported.`)
  }
  return out
}

// ---- 1Password --------------------------------------------------------------

type PuxField = { title?: string; id?: string; value?: Record<string, unknown> }
type PuxItem = {
  state?: string
  categoryUuid?: string
  overview?: { title?: string; url?: string; urls?: { url?: string }[] }
  details?: { loginFields?: { value?: string; designation?: string }[]; notesPlain?: string; password?: string; sections?: { fields?: PuxField[] }[] }
}

// The text of a .1pux's export.data.
function onePasswordData(text: string): Imported {
  const out = empty()
  const j = json(text, "1Password") as { accounts?: { vaults?: { items?: { item?: PuxItem }[] }[] }[] }
  if (!Array.isArray(j?.accounts)) throw new Error("That isn't a 1Password .1pux export.")
  for (const a of j.accounts)
    for (const v of a.vaults ?? [])
      for (const w of v.items ?? []) {
        const it = (w.item ?? w) as PuxItem
        const title = it.overview?.title ?? ""
        if (it.state === "archived") continue
        const fields = (it.details?.sections ?? []).flatMap((s) => s.fields ?? [])
        const field = (k: string) => it.details?.loginFields?.find((f) => f.designation === k)?.value
        const text_ = (f?: PuxField) => (f?.value ? String(Object.values(f.value).find((x) => typeof x === "string") ?? "") : "")
        const notes = it.details?.notesPlain ?? ""
        const url = it.overview?.url || it.overview?.urls?.[0]?.url || ""
        const cat = it.categoryUuid
        if (cat === "001" || cat === "005")
          add(out, { title, username: field("username"), password: field("password") ?? it.details?.password, url, totp: String(fields.map((f) => f.value?.totp).find(Boolean) ?? ""), notes, kind: "login" })
        else if (cat === "003") add(out, { title, notes, kind: "note" })
        else if (cat === "112")
          add(out, { title, password: text_(fields.find((f) => /credential|token|key/i.test(f.id ?? f.title ?? ""))) || text_(fields.find((f) => f.value && "concealed" in f.value)), url: "", notes, kind: "api_key" })
        else out.errors.push(`Skipped “${title}”: this 1Password item type isn't imported.`)
      }
  return out
}

function onePassword(text: string, name = ""): Imported {
  return /\.csv$/i.test(name) || !/^\s*\{/.test(text) ? loginsCsv(text) : onePasswordData(text)
}

// ---- KeePass ----------------------------------------------------------------

const unxml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[e.toLowerCase()]
  )

function keepass(text: string): Imported {
  if (!/<KeePassFile[\s>]/.test(text)) throw new Error("That isn't a KeePass XML export (File → Export → KeePass XML 2.x).")
  const out = empty()
  const groups: { name: string; bin: boolean }[] = []
  const tok = /<(\/?)(Group|Entry|History)\b[^>]*>/g
  let history = 0
  let entryAt = -1
  let depth = 0
  for (let m = tok.exec(text); m; m = tok.exec(text)) {
    const [whole, close, tag] = m
    if (tag === "Group" && history === 0 && entryAt < 0) {
      if (close) groups.pop()
      else {
        const name = /^\s*(?:<UUID>[^<]*<\/UUID>\s*)?<Name>([^<]*)<\/Name>/.exec(text.slice(m.index + whole.length))?.[1] ?? ""
        groups.push({ name: unxml(name), bin: /recycle bin/i.test(name) })
      }
    } else if (tag === "History") history += close ? -1 : 1
    else if (tag === "Entry") {
      if (!close) {
        if (history === 0 && depth++ === 0) entryAt = m.index + whole.length
      } else if (history === 0 && --depth === 0 && entryAt >= 0) {
        const body = text.slice(entryAt, m.index).replace(/<History>[\s\S]*?<\/History>/g, "")
        entryAt = -1
        if (groups.some((g) => g.bin)) continue
        const f: Record<string, string> = {}
        for (const s of body.matchAll(/<String>\s*<Key>([\s\S]*?)<\/Key>\s*<Value[^>]*?(?:\/>|>([\s\S]*?)<\/Value>)\s*<\/String>/g)) f[unxml(s[1])] = unxml(s[2] ?? "")
        add(out, { title: f.Title ?? "", username: f.UserName, password: f.Password, url: f.URL, totp: f.otp || f.TOTP || f.TimeOtp || "", notes: f.Notes })
      }
    }
  }
  return out
}

export function importFrom(tool: Tool, text: string, name = ""): Imported {
  const out = { infisical, doppler, "1password": onePassword, bitwarden, keepass }[tool](text, name)
  if (!out.pairs.length && !out.entries.length) throw new Error(out.errors[0] ?? "Nothing to import was found in that file.")
  return out
}
