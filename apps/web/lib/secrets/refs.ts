// ${KEY} (same env and folder), ${env.KEY} and ${env.folder.sub.KEY} references
// between secrets. Expanded in the UI preview and on export; cycles are caught.
// Write \${KEY} to keep a literal ${KEY}. Pure, so node --test can load it.

export type Scope = { env: string; folder: string } // folder is "a/b" or "" for the root
export type Lookup = (env: string, folder: string, key: string) => string | undefined
export type RefError = { kind: "cycle" | "missing"; message: string }

const RE = /(\\)?\$\{([^}]*)\}/g

export type Ref = Scope & { key: string }

export function parseRef(inner: string, scope: Scope): Ref | null {
  const parts = inner.trim().split(".")
  if (parts.some((p) => !p)) return null
  if (parts.length === 1) return { ...scope, key: parts[0] }
  const key = parts[parts.length - 1]
  return { env: parts[0], folder: parts.slice(1, -1).join("/"), key }
}

const label = (r: Ref) => [r.env, ...(r.folder ? r.folder.split("/") : []), r.key].join(".")

// The references a value makes, relative to where it lives.
export function findRefs(value: string, scope: Scope) {
  const out: Ref[] = []
  for (const m of value.matchAll(RE)) {
    if (m[1]) continue
    const r = parseRef(m[2], scope)
    if (r) out.push(r)
  }
  return out
}

export const hasRefs = (value: string) => findRefs(value, { env: "", folder: "" }).length > 0

// `self` is "env.folder.KEY" of the secret being expanded, so a value that
// loops back to itself is a cycle. Unresolvable references stay as written.
export function expand(value: string, scope: Scope, lookup: Lookup, self?: string) {
  const errors: RefError[] = []
  const walk = (v: string, at: Scope, stack: string[]): string =>
    v.replace(RE, (whole, esc: string | undefined, inner: string) => {
      if (esc) return whole.slice(1)
      const r = parseRef(inner, at)
      if (!r) return whole
      const id = label(r)
      if (stack.includes(id)) {
        errors.push({ kind: "cycle", message: `Circular reference: ${[...stack, id].join(" → ")}` })
        return whole
      }
      const found = lookup(r.env, r.folder, r.key)
      if (found === undefined) {
        errors.push({ kind: "missing", message: `No secret named ${id}` })
        return whole
      }
      return walk(found, { env: r.env, folder: r.folder }, [...stack, id])
    })
  const out = walk(value, scope, self ? [self] : [])
  return { value: out, errors }
}

export const selfId = (s: Scope, key: string) => label({ ...s, key })
