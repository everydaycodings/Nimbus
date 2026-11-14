// ${KEY} (same env and folder), ${env.KEY} and ${env.folder.sub.KEY} references
// between secrets. Expanded in the UI preview and on export; cycles are caught.
// Write \${KEY} to keep a literal ${KEY}. Pure, so node --test can load it.

export type Scope = { env: string; folder: string } // folder is "a/b" or "" for the root
export type Lookup = (env: string, folder: string, key: string) => string | undefined
export type RefError = { kind: "cycle" | "missing" | "limit"; message: string }

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
// Each reference resolves once per call (memo), nesting stops at MAX_DEPTH and the
// text built stops at MAX_EXPANDED, so ${A}${A} chains can't blow up time or memory.
export const MAX_DEPTH = 32
export const MAX_EXPANDED = 256 * 1024
export function expand(value: string, scope: Scope, lookup: Lookup, self?: string) {
  const errors: RefError[] = []
  const memo = new Map<string, string>()
  let spent = 0
  const limit = (message: string) => {
    if (!errors.some((e) => e.kind === "limit")) errors.push({ kind: "limit", message })
    spent = Infinity
  }
  const walk = (v: string, at: Scope, stack: string[]): string =>
    v.replace(RE, (whole, esc: string | undefined, inner: string) => {
      if (esc) return whole.slice(1)
      if (spent > MAX_EXPANDED) return whole
      const r = parseRef(inner, at)
      if (!r) return whole
      const id = label(r)
      if (stack.includes(id)) {
        errors.push({ kind: "cycle", message: `Circular reference: ${[...stack, id].join(" → ")}` })
        return whole
      }
      let out = memo.get(id)
      if (out === undefined) {
        const found = lookup(r.env, r.folder, r.key)
        if (found === undefined) {
          errors.push({ kind: "missing", message: `No secret named ${id}` })
          return whole
        }
        if (stack.length >= MAX_DEPTH) {
          limit(`References nest more than ${MAX_DEPTH} deep at ${id}`)
          return whole
        }
        out = walk(found, { env: r.env, folder: r.folder }, [...stack, id])
        memo.set(id, out)
      }
      spent += out.length
      if (spent > MAX_EXPANDED) {
        limit(`References expand to more than ${MAX_EXPANDED / 1024} KB`)
        return whole
      }
      return out
    })
  const out = walk(value, scope, self ? [self] : [])
  return { value: out, errors }
}

export const selfId = (s: Scope, key: string) => label({ ...s, key })

// env slug -> the other env slugs its values reference. Built from plaintext at write
// time; only slugs leave here, never values.
export function refGraph(items: { scope: Scope; value: string }[]) {
  const g = new Map<string, Set<string>>()
  for (const i of items)
    for (const r of findRefs(i.value, i.scope)) {
      if (r.env === i.scope.env) continue
      if (!g.has(i.scope.env)) g.set(i.scope.env, new Set())
      g.get(i.scope.env)!.add(r.env)
    }
  return g
}

// Envs that reference any of `changed`, directly or through others (not `changed`
// itself). Grows a visited set to a fixpoint, so cycles end.
export function dependents(g: Map<string, Set<string>>, changed: string[]) {
  const hit = new Set(changed)
  for (let grew = true; grew; ) {
    grew = false
    for (const [env, refs] of g)
      if (!hit.has(env) && [...refs].some((r) => hit.has(r))) {
        hit.add(env)
        grew = true
      }
  }
  return [...hit].filter((e) => !changed.includes(e))
}
