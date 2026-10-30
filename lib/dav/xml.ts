// WebDAV XML in and out, without an XML library: responses are built from
// strings, and requests only ever need the property names they mention.
// Pure, so `node --test` covers it.

export type Entry = {
  href: string
  name: string
  folder: boolean
  size?: number
  mime?: string | null
  created: Date
  modified: Date
  etag?: string
  quota?: { used: number; available: number | null }
  lock?: Lock | null
}

export type Lock = {
  token: string
  owner: string
  depth: "0" | "infinity"
  timeout: number
  root: string
}

export const esc = (s: string) =>
  s.replace(
    /[<>&"']/g,
    (c) =>
      ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[
        c
      ]!
  )

// Each path segment percent-encoded; folders end in "/".
export const href = (prefix: string, names: string[], folder: boolean) =>
  prefix +
  names.map((n) => encodeURIComponent(n)).join("/") +
  (folder && names.length ? "/" : "")

const SUPPORTED_LOCK =
  "<D:supportedlock><D:lockentry><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockentry></D:supportedlock>"

export function activeLock(l: Lock) {
  return (
    "<D:activelock><D:locktype><D:write/></D:locktype><D:lockscope><D:exclusive/></D:lockscope>" +
    `<D:depth>${l.depth === "0" ? "0" : "infinity"}</D:depth>` +
    (l.owner ? `<D:owner>${l.owner}</D:owner>` : "") +
    `<D:timeout>Second-${l.timeout}</D:timeout>` +
    `<D:locktoken><D:href>${esc(l.token)}</D:href></D:locktoken>` +
    `<D:lockroot><D:href>${esc(l.root)}</D:href></D:lockroot>` +
    "</D:activelock>"
  )
}

export const lockDiscovery = (l: Lock) =>
  `<?xml version="1.0" encoding="utf-8"?><D:prop xmlns:D="DAV:"><D:lockdiscovery>${activeLock(l)}</D:lockdiscovery></D:prop>`

function props(e: Entry) {
  const p = [
    `<D:displayname>${esc(e.name)}</D:displayname>`,
    e.folder
      ? "<D:resourcetype><D:collection/></D:resourcetype>"
      : "<D:resourcetype/>",
    `<D:creationdate>${e.created.toISOString()}</D:creationdate>`,
    `<D:getlastmodified>${e.modified.toUTCString()}</D:getlastmodified>`,
    SUPPORTED_LOCK,
    `<D:lockdiscovery>${e.lock ? activeLock(e.lock) : ""}</D:lockdiscovery>`,
  ]
  if (e.etag) p.push(`<D:getetag>"${esc(e.etag)}"</D:getetag>`)
  if (!e.folder) {
    p.push(`<D:getcontentlength>${e.size ?? 0}</D:getcontentlength>`)
    p.push(
      `<D:getcontenttype>${esc(e.mime || "application/octet-stream")}</D:getcontenttype>`
    )
  }
  if (e.quota) {
    p.push(`<D:quota-used-bytes>${e.quota.used}</D:quota-used-bytes>`)
    if (e.quota.available !== null)
      p.push(
        `<D:quota-available-bytes>${e.quota.available}</D:quota-available-bytes>`
      )
  }
  return p.join("")
}

export function multistatus(entries: Entry[]) {
  return (
    '<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">' +
    entries
      .map(
        (e) =>
          `<D:response><D:href>${esc(e.href)}</D:href><D:propstat><D:prop>${props(e)}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`
      )
      .join("") +
    "</D:multistatus>"
  )
}

// The properties a PROPPATCH names, as [namespace, local name]. Nimbus keeps
// none of them (clients mostly set modification times), but answers each with
// 200 so the client's save goes on.
export function patchedProps(body: string): [string, string][] {
  const ns = new Map<string, string>()
  for (const m of body.matchAll(/xmlns(?::([\w.-]+))?\s*=\s*"([^"]*)"/g))
    ns.set(m[1] ?? "", m[2])
  const out: [string, string][] = []
  for (const block of body.matchAll(
    /<(?:[\w.-]+:)?prop\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?prop>/g
  ))
    for (const m of block[1].matchAll(
      /<(?:([\w.-]+):)?([\w.-]+)[^>]*?(?:xmlns="([^"]*)")?[^>]*?\/?>/g
    )) {
      if (m[0].startsWith("</")) continue
      out.push([m[3] ?? ns.get(m[1] ?? "") ?? "", m[2]])
    }
  return out
}

export function proppatchReply(target: string, names: [string, string][]) {
  const p = names
    .map(([ns, n], i) => `<x${i}:${n} xmlns:x${i}="${esc(ns)}"/>`)
    .join("")
  return (
    '<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">' +
    `<D:response><D:href>${esc(target)}</D:href><D:propstat><D:prop>${p}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>` +
    "</D:multistatus>"
  )
}

// The raw inner XML of <owner>, echoed back in lock answers.
export function lockOwner(body: string) {
  const m = body.match(
    /<(?:[\w.-]+:)?owner\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?owner>/
  )
  return m ? m[1].trim() : ""
}

// Tokens from an If header: (<opaquelocktoken:…>) or <url> (<token>).
export const ifTokens = (h: string | null) =>
  new Set([...(h ?? "").matchAll(/<(urn:uuid:[^>]+|opaquelocktoken:[^>]+)>/g)].map((m) => m[1]))

// An If header as lists of conditions: the header holds when every condition
// of some list does. A condition is a lock token (<…>, including the
// never-held <DAV:no-lock>) or an entity tag ([…]), either one maybe negated.
// Resource tags (<url> before a list) aren't told apart: every list is checked
// against the request's own resource, which is what clients send.
export type Cond = { not: boolean; token?: string; etag?: string }

export function parseIf(h: string | null): Cond[][] {
  const lists: Cond[][] = []
  for (const list of (h ?? "").matchAll(/\(([^)]*)\)/g)) {
    const conds: Cond[] = []
    for (const m of list[1].matchAll(/(Not\s+)?(?:<([^>]*)>|\[([^\]]*)\])/gi))
      conds.push(
        m[2] !== undefined
          ? { not: Boolean(m[1]), token: m[2] }
          : { not: Boolean(m[1]), etag: m[3].replace(/^W\//, "").replace(/"/g, "") }
      )
    if (conds.length) lists.push(conds)
  }
  return lists
}

export const ifHolds = (
  lists: Cond[][],
  held: Set<string>,
  etag: string | undefined
) =>
  !lists.length ||
  lists.some((l) =>
    l.every((c) => (c.token !== undefined ? held.has(c.token) : c.etag === etag) !== c.not)
  )

// "Second-600", "Infinite", or a list of both; capped at an hour.
export function timeout(h: string | null) {
  const n = Number(h?.match(/Second-(\d+)/i)?.[1])
  return Number.isFinite(n) && n > 0 ? Math.min(n, 3600) : 3600
}
