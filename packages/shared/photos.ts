// The Photos timeline's rules, shared by the server, the web page and the app.
/** "2024-05" of a date, in the viewer's time zone. */
export const monthKey = (iso: string) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

/** "May 2024", or just "May" for this year. */
export function monthTitle(key: string, now = new Date()) {
  const [y, m] = key.split("-").map(Number)
  const name = new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long" })
  return y === now.getFullYear() ? name : `${name} ${y}`
}

/** Consecutive items with the same month, in the order given (newest first). */
export function groupByMonth<T extends { takenAt: string }>(items: T[]) {
  const groups: { key: string; items: T[] }[] = []
  for (const it of items) {
    const key = monthKey(it.takenAt)
    const last = groups[groups.length - 1]
    if (last?.key === key) last.items.push(it)
    else groups.push({ key, items: [it] })
  }
  return groups
}

/** The page cursor: the last item's time (to the millisecond) and id. */
export const photoCursor = (takenAt: string, id: string) => `${Date.parse(takenAt)}_${id}`

export function parsePhotoCursor(cursor: string | undefined) {
  const m = /^(-?\d+)_([0-9a-f-]{36})$/i.exec(cursor ?? "")
  return m ? { ms: Number(m[1]), id: m[2] } : null
}
