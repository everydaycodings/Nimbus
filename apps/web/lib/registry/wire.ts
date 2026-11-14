// Pure request parsing for the registry protocol, kept apart so node --test can load it.

// The password out of an Authorization header: Basic user:password, or Bearer password.
export function credential(header: string | null): string | null {
  if (!header) return null
  const [scheme, value = ""] = header.trim().split(/\s+/, 2)
  if (/^bearer$/i.test(scheme)) return value || null
  if (!/^basic$/i.test(scheme)) return null
  const raw = Buffer.from(value, "base64").toString("utf8")
  return raw.slice(raw.indexOf(":") + 1) || null
}

// n and last as the spec's pagination asks for them. Null when n is invalid.
export function paginate(q: URLSearchParams, all: string[], path: string): { items: string[]; link?: string } | null {
  const raw = q.get("n")
  const n = raw === null ? null : Number(raw)
  if (n !== null && (!Number.isInteger(n) || n < 0)) return null
  const last = q.get("last")
  let rest = last ? all.filter((x) => x > last) : all
  let link: string | undefined
  if (n !== null && rest.length > n) {
    rest = rest.slice(0, n)
    if (n > 0) link = `<${path}?n=${n}&last=${encodeURIComponent(rest[n - 1])}>; rel="next"`
  }
  return { items: n === 0 ? [] : rest, link }
}

// "start-end" or "bytes start-end" of a chunk upload; null when malformed.
export function contentRange(h: string): { start: number; end: number } | null {
  const m = /^(?:bytes\s+)?(\d+)-(\d+)$/.exec(h.trim())
  return m && Number(m[2]) >= Number(m[1]) ? { start: Number(m[1]), end: Number(m[2]) } : null
}
