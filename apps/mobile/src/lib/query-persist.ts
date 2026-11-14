// Saves the lists you've looked at so the app can open and browse with no connection. TanStack's own
// dehydrate/hydrate, one SQLite row per query, so a list is written once when it changes.
import { dehydrate, hydrate, type Query, type QueryClient } from "@tanstack/react-query"

import { NO_FILTERS } from "./documents-rules"
import { db } from "./offline-db"

const KEPT = new Set(["list", "item", "counts", "tags", "docs"])
const SKIP_LISTS = ["/trash", "/search", "/tags/"]
const MAX_PER_ACCOUNT = 300

const isPlain = (f: unknown) => JSON.stringify(f) === JSON.stringify(NO_FILTERS)

// What's worth keeping: Files, folders, Recent, Starred, Shared, an item's details, the counts, tags and me.
function keep(q: Query) {
  const [a, b, c] = q.queryKey as [string, string, string]
  if (q.state.status !== "success") return null
  if (a === "me") return b
  if (!KEPT.has(b)) return null
  // Documents: only the unfiltered list and the summary; filtered lists, OCR text and the rest are not saved.
  if (b === "docs" && !(c === "summary" || (c === "list" && isPlain(q.queryKey[3])))) return null
  if (b === "list" && SKIP_LISTS.some((p) => String(c).startsWith(p))) return null
  return a
}

// Before the first render, so a launch with no network starts from what was saved.
export function restoreQueries(client: QueryClient) {
  try {
    const rows = db().getAllSync<{ data: string }>("SELECT data FROM qcache")
    hydrate(client, { mutations: [], queries: rows.map((r) => JSON.parse(r.data)) })
  } catch {} // A damaged row only costs the saved copy.
}

export function persistQueries(client: QueryClient) {
  const dirty = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = () => {
    timer = null
    const hashes = new Set(dirty)
    dirty.clear()
    try {
      const d = db()
      const { queries } = dehydrate(client, { shouldDehydrateQuery: (q) => hashes.has(q.queryHash) })
      const touched = new Set<string>()
      for (const q of queries) {
        const account = keep({ queryKey: q.queryKey, state: q.state } as Query)
        if (!account) continue
        touched.add(account)
        d.runSync("INSERT OR REPLACE INTO qcache(account,hash,data,updated) VALUES(?,?,?,?)", account, q.queryHash, JSON.stringify(q), Date.now())
      }
      for (const account of touched)
        d.runSync(
          "DELETE FROM qcache WHERE account=? AND hash NOT IN (SELECT hash FROM qcache WHERE account=? ORDER BY updated DESC LIMIT ?)",
          account, account, MAX_PER_ACCOUNT
        )
    } catch {}
  }
  return client.getQueryCache().subscribe((e) => {
    if (e.type !== "updated" || e.action.type !== "success" || !keep(e.query)) return
    dirty.add(e.query.queryHash)
    // ponytail: a list is rewritten whole each time; fine for hundreds of rows, split pages if it ever drags.
    timer ??= setTimeout(flush, 2000)
  })
}
