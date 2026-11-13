// Dynamic database credentials: the pure parts (templates, quoting, names, TTLs).
// Relative-import safe so node --test can load it.
import { randomBytes, randomInt } from "node:crypto"

import { DEFAULT_PORT, DEFAULT_TEMPLATE, ENGINES, ENGINE_LABEL, fmtTtl, type Engine } from "./dyn-consts.ts"

export { DEFAULT_PORT, DEFAULT_TEMPLATE, ENGINES, ENGINE_LABEL, fmtTtl, type Engine }

// ---- Names and passwords ------------------------------------------------------

// Only these ever reach a statement: ours are random, and a rotation target is checked on save.
export const USER_RE = /^[A-Za-z0-9_.-]{1,63}$/
const PASS_RE = /^[A-Za-z0-9]{16,128}$/
const EXPIRY_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/

export const newUsername = () => `nim_${randomBytes(6).toString("hex")}`

const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
export const newPassword = (n = 32) => Array.from({ length: n }, () => ALNUM[randomInt(ALNUM.length)]).join("")

// ---- Templates ----------------------------------------------------------------

export type Vars = { username: string; password?: string; expiry?: string }
const HOLE = /\{\{\s*([a-z]+)\s*\}\}/g

// The placeholders a template uses; anything but the three is an error.
export function holes(tpl: string) {
  const found = new Set<string>()
  for (const m of tpl.matchAll(HOLE)) found.add(m[1])
  return found
}

export function validateTemplate(tpl: string, kind: "create" | "revoke") {
  if (!tpl.trim()) return "Write the statements."
  for (const h of holes(tpl)) if (!["username", "password", "expiry"].includes(h)) return `{{${h}}} isn't a placeholder. Use {{username}}, {{password}} or {{expiry}}.`
  if (/\{\{(?![\sa-z]+\}\})/.test(tpl)) return "A {{ isn't closed. Placeholders look like {{username}}."
  const h = holes(tpl)
  if (!h.has("username")) return "The statements need {{username}}."
  if (kind === "create" && !h.has("password")) return "The creation statements need {{password}}."
  if (kind === "revoke" && h.has("password")) return "Revoking doesn't know the password. Remove {{password}}."
  return null
}

// Every value is checked against a strict pattern first, so even a template that puts
// {{password}} between quotes can't be broken out of.
export function render(tpl: string, v: Vars) {
  if (!USER_RE.test(v.username)) throw new Error("That user name isn't allowed.")
  if (v.password !== undefined && !PASS_RE.test(v.password)) throw new Error("That password isn't allowed.")
  if (v.expiry !== undefined && !EXPIRY_RE.test(v.expiry)) throw new Error("That expiry isn't valid.")
  return tpl.replace(HOLE, (_, name: string) => {
    const val = name === "username" ? v.username : name === "password" ? v.password : name === "expiry" ? v.expiry : undefined
    if (val === undefined) throw new Error(`{{${name}}} has no value here.`)
    return val
  })
}

// ---- Quoting (for statements Nimbus builds itself) ------------------------------------

export function quoteIdent(engine: "postgres" | "mysql", name: string) {
  if (!name || /\0/.test(name)) throw new Error("Not a valid name.")
  return engine === "mysql" ? "`" + name.replace(/`/g, "``") + "`" : `"${name.replace(/"/g, '""')}"`
}

export function quoteLiteral(engine: "postgres" | "mysql", v: string) {
  if (/\0/.test(v)) throw new Error("Not a valid value.")
  const s = (engine === "mysql" ? v.replace(/\\/g, "\\\\") : v).replace(/'/g, "''")
  // E'' keeps backslashes literal under any standard_conforming_strings setting.
  return engine === "postgres" && v.includes("\\") ? `E'${v.replace(/\\/g, "\\\\").replace(/'/g, "''")}'` : `'${s}'`
}

// ---- Splitting ------------------------------------------------------------------------

// SQL: on ; outside quotes and -- comments.
export function splitSql(text: string) {
  const out: string[] = []
  let cur = ""
  let q: string | null = null
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) {
      cur += ch
      if (ch === q) {
        if (text[i + 1] === q) cur += text[++i]
        else q = null
      }
    } else if (ch === "'" || ch === '"' || ch === "`") {
      q = ch
      cur += ch
    } else if (ch === "-" && text[i + 1] === "-") {
      while (i < text.length && text[i] !== "\n") i++
    } else if (ch === ";") {
      if (cur.trim()) out.push(cur.trim())
      cur = ""
    } else cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

// Redis: one command per line, words split on spaces, "double" or 'single' quotes group.
export function splitRedis(text: string) {
  const cmds: string[][] = []
  for (const line of text.split("\n")) {
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    const words: string[] = []
    const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g
    for (const m of t.matchAll(re)) words.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, "$1") : (m[2] ?? m[3]))
    cmds.push(words)
  }
  return cmds
}

// Mongo: one JSON command, or an array of them.
export function parseMongo(text: string): Record<string, unknown>[] {
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    throw new Error("MongoDB statements are JSON: one command object or an array of them.")
  }
  const list = Array.isArray(v) ? v : [v]
  if (!list.length || list.some((c) => !c || typeof c !== "object" || Array.isArray(c) || !Object.keys(c).length))
    throw new Error("Each MongoDB statement is a command object, like {\"createUser\": …}.")
  return list as Record<string, unknown>[]
}

// Checked at save time with placeholder values, so a bad template fails there and not at the first lease.
export function checkSyntax(engine: Engine, tpl: string) {
  const text = render(tpl, { username: "nim_000000000000", password: "A".repeat(32), expiry: "2030-01-01T00:00:00Z" })
  if (engine === "mongodb") parseMongo(text)
  else if (engine === "redis") {
    if (!splitRedis(text).length) throw new Error("Write at least one command.")
  } else if (!splitSql(text).length) throw new Error("Write at least one statement.")
}

// ---- TTLs ------------------------------------------------------------------------------

// "90", "30m", "2h", "7d" → seconds, or null.
export function parseTtl(v: unknown): number | null {
  if (typeof v === "number") return Number.isInteger(v) && v > 0 ? v : null
  const m = /^(\d+)\s*([smhd]?)$/i.exec(String(v ?? "").trim())
  if (!m) return null
  const n = Number(m[1]) * ({ "": 1, s: 1, m: 60, h: 3600, d: 86400 }[m[2].toLowerCase() as "" | "s" | "m" | "h" | "d"])
  return n > 0 ? n : null
}

export const MIN_TTL = 60
export const MAX_TTL_LIMIT = 90 * 86400

// The longest a lease may run from its issue time.
export const clampTtl = (want: number, max: number) => Math.max(MIN_TTL, Math.min(want, max))

// Rotation by alternation: the other user.
export const otherUser = (active: string | null, a: string, b: string) => (active === a ? b : a)

// What the CLI prints for a lease.
export function leaseUrl(engine: Engine, l: { host: string; port: number; database: string; username: string; password: string; tls: boolean }) {
  const e = encodeURIComponent
  const auth = `${e(l.username)}:${e(l.password)}@${l.host.includes(":") ? `[${l.host}]` : l.host}:${l.port}`
  switch (engine) {
    case "postgres": return `postgres://${auth}/${e(l.database || "postgres")}${l.tls ? "?sslmode=require" : ""}`
    case "mysql": return `mysql://${auth}/${e(l.database)}${l.tls ? "?ssl=true" : ""}`
    case "redis": return `${l.tls ? "rediss" : "redis"}://${auth}`
    case "mongodb": return `mongodb://${auth}/${e(l.database || "admin")}?authSource=${e(l.database || "admin")}${l.tls ? "&tls=true" : ""}`
  }
}
