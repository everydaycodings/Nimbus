// Comment text rules, shared by the server, the web page and the app.
// A mention is stored as <@userId>, so a rename shows the new name; editors show it as "@Name".

export const REACTIONS = ["👍", "❤️", "😂", "🎉", "👀"] as const
export type Reaction = (typeof REACTIONS)[number]
export const MAX_COMMENT = 5000

const TOKEN = /<@([A-Za-z0-9_-]{1,64})>/g
const URL_RE = /https?:\/\/[^\s<>]*[^\s<>.,;:!?)\]'"]/g

/** Distinct user ids mentioned in a stored body. */
export const mentionIds = (body: string) => [...new Set([...body.matchAll(TOKEN)].map((m) => m[1]))]

export type Part = { text: string } | { mention: string; name: string } | { link: string }

/** A stored body as text, mentions and links, for rendering. Unknown people read "@someone". */
export function commentParts(body: string, nameOf: (id: string) => string | undefined): Part[] {
  const out: Part[] = []
  const text = (s: string) => {
    let last = 0
    for (const m of s.matchAll(URL_RE)) {
      if (m.index > last) out.push({ text: s.slice(last, m.index) })
      out.push({ link: m[0] })
      last = m.index + m[0].length
    }
    if (last < s.length) out.push({ text: s.slice(last) })
  }
  let last = 0
  for (const m of body.matchAll(TOKEN)) {
    if (m.index > last) text(body.slice(last, m.index))
    out.push({ mention: m[1], name: nameOf(m[1]) ?? "someone" })
    last = m.index + m[0].length
  }
  if (last < body.length) text(body.slice(last))
  return out
}

/** A stored body as editable text: "<@id>" becomes "@Name". */
export const decodeMentions = (body: string, nameOf: (id: string) => string | undefined) =>
  body.replace(TOKEN, (_, id: string) => `@${nameOf(id) ?? "someone"}`)

/** Editor text back to a stored body: "@Name" of each person becomes "<@id>". Longest names first, so
 *  "@Ana Smith" wins over "@Ana". */
export function encodeMentions(text: string, people: { id: string; name: string }[]) {
  let out = text
  for (const p of [...people].sort((a, b) => b.name.length - a.name.length)) {
    if (!p.name) continue
    const esc = p.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    out = out.replace(new RegExp(`@${esc}(?![\\p{L}\\p{N}_])`, "gu"), `<@${p.id}>`)
  }
  return out
}

/** The "@query" being typed just before the caret, or null. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const at = before.lastIndexOf("@")
  if (at < 0 || (at > 0 && !/\s/.test(before[at - 1]))) return null
  const query = before.slice(at + 1)
  if (query.length > 30 || /[\n@]/.test(query)) return null
  return { start: at, query }
}

/** People whose name matches the query, best first. */
export const matchPeople = <P extends { name: string }>(people: P[], query: string) => {
  const q = query.toLowerCase()
  return people
    .filter((p) => p.name.toLowerCase().includes(q))
    .sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)))
    .slice(0, 6)
}

/** "1:23" or "1:02:03" for a point in a video or audio file. */
export function formatAt(seconds: number) {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60))
  const ss = String(s % 60).padStart(2, "0")
  return h ? `${h}:${mm.padStart(2, "0")}:${ss}` : `${mm}:${ss}`
}
