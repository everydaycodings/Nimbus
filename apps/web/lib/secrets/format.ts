// Reading and writing secrets as .env, JSON and YAML, plus the value types and
// the import preview. Pure, so node --test can load it.
import yaml from "js-yaml"

import { KEY_RE } from "./consts.ts"

export { FOLDER_RE, KEY_RE, SECRET_TYPES, SLUG_RE, type SecretType } from "./consts.ts"

export type Pair = { key: string; value: string }
export type Parsed = { pairs: Pair[]; errors: string[] }

// .env: KEY=value, `export KEY=value`, "double" (escapes, multiline), 'single'
// (literal) and bare values (trailing ` #comment` dropped).
export function parseEnv(text: string): Parsed {
  const pairs: Pair[] = []
  const errors: string[] = []
  const lines = text.replace(/\r\n?/g, "\n").split("\n")
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line.startsWith("#")) continue
    const m = /^(?:export\s+)?([^=\s]+)\s*=\s*(.*)$/.exec(line)
    if (!m || !KEY_RE.test(m[1])) {
      errors.push(`Line ${i + 1}: not KEY=value.`)
      continue
    }
    let rest = m[2]
    let value: string
    if (rest.startsWith('"')) {
      // Runs to the next unescaped quote, which may be on a later line.
      let body = rest.slice(1)
      let end = closing(body)
      while (end < 0 && i + 1 < lines.length) {
        body += "\n" + lines[++i]
        end = closing(body)
      }
      if (end < 0) {
        errors.push(`Line ${i + 1}: unclosed quote.`)
        continue
      }
      value = body
        .slice(0, end)
        .replace(/\\(.)/g, (_, c) => (c === "n" ? "\n" : c === "r" ? "\r" : c === "t" ? "\t" : c))
    } else if (rest.startsWith("'")) {
      const end = rest.indexOf("'", 1)
      value = end < 0 ? rest.slice(1) : rest.slice(1, end)
    } else {
      rest = rest.replace(/\s+#.*$/, "")
      value = rest.trim()
    }
    pairs.push({ key: m[1], value })
  }
  return { pairs, errors }
}

function closing(s: string) {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\") i++
    else if (s[i] === '"') return i
  }
  return -1
}

// Nested objects become KEY_SUB_KEY; arrays and everything else become strings.
export function flatten(obj: unknown, prefix = ""): Pair[] {
  if (obj && typeof obj === "object" && !Array.isArray(obj))
    return Object.entries(obj).flatMap(([k, v]) =>
      flatten(v, prefix ? `${prefix}_${k}` : k)
    )
  const value =
    obj === null || obj === undefined
      ? ""
      : typeof obj === "object"
        ? JSON.stringify(obj)
        : String(obj)
  return prefix ? [{ key: prefix, value }] : []
}

function structured(text: string, parse: (t: string) => unknown): Parsed {
  let data: unknown
  try {
    data = parse(text)
  } catch (e) {
    return { pairs: [], errors: [(e as Error).message.split("\n")[0]] }
  }
  if (!data || typeof data !== "object" || Array.isArray(data))
    return { pairs: [], errors: ["Expected an object of KEY: value."] }
  const pairs: Pair[] = []
  const errors: string[] = []
  for (const p of flatten(data))
    if (KEY_RE.test(p.key)) pairs.push(p)
    else errors.push(`"${p.key}" isn't a valid key (letters, digits, underscore).`)
  return { pairs, errors }
}

export const parseJson = (t: string) => structured(t, JSON.parse)
export const parseYaml = (t: string) =>
  structured(t, (s) => yaml.load(s, { schema: yaml.JSON_SCHEMA }))

export type Format = "env" | "json" | "yaml"

// From the file name, else the content.
export function detectFormat(text: string, name = ""): Format {
  const ext = name.toLowerCase().split(".").pop()
  if (ext === "json") return "json"
  if (ext === "yaml" || ext === "yml") return "yaml"
  if (ext === "env" || name.toLowerCase().startsWith(".env")) return "env"
  const t = text.trimStart()
  if (t.startsWith("{")) return "json"
  return /^(?:export\s+)?[A-Za-z_]\w*\s*=/m.test(t) ? "env" : "yaml"
}

export function parseAny(text: string, name?: string): Parsed {
  const f = detectFormat(text, name)
  return f === "json" ? parseJson(text) : f === "yaml" ? parseYaml(text) : parseEnv(text)
}

const quoteEnv = (v: string) =>
  /^[A-Za-z0-9_./:@%+,=-]*$/.test(v)
    ? v
    : `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r")}"`

export function serialize(pairs: Pair[], format: Format) {
  if (format === "json")
    return JSON.stringify(Object.fromEntries(pairs.map((p) => [p.key, p.value])), null, 2) + "\n"
  if (format === "yaml")
    return yaml.dump(Object.fromEntries(pairs.map((p) => [p.key, p.value])), {
      lineWidth: -1,
      forceQuotes: true,
    })
  return pairs.map((p) => `${p.key}=${quoteEnv(p.value)}`).join("\n") + (pairs.length ? "\n" : "")
}

// ---- Types ----------------------------------------------------------------

// An error to show, or null when the value fits the type. Empty is always fine.
export function validateType(type: string | null | undefined, value: string) {
  if (!type || type === "string" || value === "") return null
  const t = value.trim()
  switch (type) {
    case "number":
      return t !== "" && Number.isFinite(Number(t)) ? null : "Not a number."
    case "bool":
      return /^(true|false)$/i.test(t) ? null : "Use true or false."
    case "url":
      try {
        new URL(t)
        return null
      } catch {
        return "Not a valid URL."
      }
    case "json":
      try {
        JSON.parse(t)
        return null
      } catch {
        return "Not valid JSON."
      }
    case "pem":
      return /-----BEGIN [A-Z0-9 ]+-----[\s\S]+-----END [A-Z0-9 ]+-----/.test(t)
        ? null
        : "Not a PEM block."
    default:
      return "Unknown type."
  }
}

// ---- Import preview -------------------------------------------------------

export type ImportRow = Pair & {
  status: "new" | "changed" | "same" | "duplicate"
}

// What an import would do against what's there. A key repeated in the input is
// "duplicate" on its earlier copies; the last one is the one that counts.
export function planImport(incoming: Pair[], existing: Map<string, string>): ImportRow[] {
  const last = new Map(incoming.map((p, i) => [p.key, i]))
  return incoming.map((p, i) => ({
    ...p,
    status:
      last.get(p.key) !== i
        ? "duplicate"
        : !existing.has(p.key)
          ? "new"
          : existing.get(p.key) === p.value
            ? "same"
            : "changed",
  }))
}

// "A, B and 3 more", for audit lines (key names only, never values).
export const names = (keys: string[]) =>
  keys.length > 8 ? `${keys.slice(0, 8).join(", ")} and ${keys.length - 8} more` : keys.join(", ")
