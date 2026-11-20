// Website Archiver (/more/archive): saved pages, their captures and the minute tick. A capture runs here in the app
// (it has the database, storage and storeFile); the worker only queues and holds the request open (scripts/worker.ts).
import "server-only"

import { and, desc, eq, inArray, isNull, max, sql } from "drizzle-orm"

import { decrypt, encrypt } from "@/lib/crypto"
import { db } from "@/lib/db"
import { archiveCookies, archivePages, archivePrefs, archiveSnapshots, nodes } from "@/lib/db/schema"
import { ago } from "@/lib/health-rules"
import { notify } from "@/lib/notify"
import { enqueueArchive } from "@/lib/redis"
import { blockPrivateHosts, checkAddress } from "@/lib/secrets/egress"
import { getSettings } from "@/lib/signup"
import { storeFile } from "@/lib/store-file"
import { mkdirp } from "@/lib/uploads"

import { browserState, capture } from "./capture.ts"
import { MAX_TAGS, cleanDomain, cleanTags, cleanUrl, cookieDomainFor, fileName, parseCookieHeader, siteOf, textHash } from "./rules.ts"

type Page = typeof archivePages.$inferSelect
type Result = { error?: string }

const iso = (d: Date | null) => (d ? d.toISOString() : null)
const DEFAULT_FOLDER = "Web archive"
const HUNG = sql`interval '30 minutes'`

// ---- Views ----------------------------------------------------------------

export type PageView = {
  id: string
  url: string
  title: string
  site: string
  tags: string[]
  intervalMin: number | null
  cookieDomain: string | null
  status: "running" | "ok" | "unchanged" | "failed" | null
  error: string | null
  lastRunAt: string | null
  nextDueAt: string | null
  snapshots: number
  lastCapturedAt: string | null
  // The newest screenshot, for the card.
  thumbId: string | null
}

export type SnapshotView = {
  id: string
  capturedAt: string
  title: string
  bytes: number
  htmlId: string | null
  pdfId: string | null
  pngId: string | null
  textId: string | null
}

export type CookieView = { id: string; domain: string; createdAt: string }

const view = (p: Page, s?: { n: number; last: Date | null; thumb: string | null }): PageView => ({
  id: p.id,
  url: p.url,
  title: p.title,
  site: p.site,
  tags: p.tags,
  intervalMin: p.intervalMin,
  cookieDomain: p.cookieDomain,
  status: p.lastStatus,
  error: p.lastError,
  lastRunAt: iso(p.lastRunAt),
  nextDueAt: iso(p.nextDueAt),
  snapshots: s?.n ?? 0,
  lastCapturedAt: iso(s?.last ?? null),
  thumbId: s?.thumb ?? null,
})

export async function listPages(userId: string): Promise<PageView[]> {
  const pages = await db.select().from(archivePages).where(eq(archivePages.userId, userId)).orderBy(desc(archivePages.createdAt))
  if (!pages.length) return []
  const ids = pages.map((p) => p.id)
  const [counts, thumbs] = await Promise.all([
    db.select({ id: archiveSnapshots.pageId, n: sql<number>`count(*)`.mapWith(Number), last: max(archiveSnapshots.capturedAt) }).from(archiveSnapshots).where(inArray(archiveSnapshots.pageId, ids)).groupBy(archiveSnapshots.pageId),
    db.selectDistinctOn([archiveSnapshots.pageId], { id: archiveSnapshots.pageId, png: archiveSnapshots.pngNodeId }).from(archiveSnapshots).where(inArray(archiveSnapshots.pageId, ids)).orderBy(archiveSnapshots.pageId, desc(archiveSnapshots.capturedAt)),
  ])
  const by = new Map(counts.map((c) => [c.id, c]))
  const thumb = new Map(thumbs.map((t) => [t.id, t.png]))
  return pages.map((p) => view(p, { n: by.get(p.id)?.n ?? 0, last: by.get(p.id)?.last ?? null, thumb: thumb.get(p.id) ?? null }))
}

export async function getPage(userId: string, id: string): Promise<{ page: PageView; snapshots: SnapshotView[] } | null> {
  const [p] = await db.select().from(archivePages).where(and(eq(archivePages.id, id), eq(archivePages.userId, userId)))
  if (!p) return null
  const snaps = await db.select().from(archiveSnapshots).where(eq(archiveSnapshots.pageId, id)).orderBy(desc(archiveSnapshots.capturedAt))
  const snapshots = snaps.map((s) => ({
    id: s.id,
    capturedAt: s.capturedAt.toISOString(),
    title: s.title,
    bytes: s.bytes,
    htmlId: s.htmlNodeId,
    pdfId: s.pdfNodeId,
    pngId: s.pngNodeId,
    textId: s.textNodeId,
  }))
  return { page: view(p, { n: snaps.length, last: snaps[0] ? new Date(snaps[0].capturedAt) : null, thumb: snaps[0]?.pngNodeId ?? null }), snapshots }
}

// The admin's address, else ARCHIVER_BROWSER_URL (setup.sh writes it when it starts the browser service).
const browserUrl = (s: { archiverBrowserUrl: string | null }) => s.archiverBrowserUrl?.trim() || process.env.ARCHIVER_BROWSER_URL?.trim() || ""

// "off" = no URL saved, "down" = saved but not answering, "ok".
export async function browserStatus() {
  return browserState(browserUrl(await getSettings()))
}

// ---- Folder and cookies ---------------------------------------------------

const ownFolder = async (userId: string, id: string) =>
  (await db.select({ id: nodes.id }).from(nodes).where(and(eq(nodes.id, id), eq(nodes.ownerId, userId), eq(nodes.kind, "folder"), isNull(nodes.trashedAt), isNull(nodes.vaultId))))[0]

// The default folder's path ("/Web archive"), or null when none is chosen (then "Web archive" is made on the first capture).
export async function defaultFolder(userId: string): Promise<{ id: string; path: string } | null> {
  const rows = await db.execute<{ id: string; path: string }>(sql`
    with recursive up as (
      select n.id, n.parent_id, n.name, 0 as depth from archive_prefs p join nodes n on n.id = p.folder_node_id where p.user_id = ${userId} and n.trashed_at is null
      union all
      select n.id, n.parent_id, n.name, up.depth + 1 from nodes n join up on n.id = up.parent_id
    )
    select (select folder_node_id from archive_prefs where user_id = ${userId}) as id, '/' || string_agg(name, '/' order by depth desc) as path from up`)
  return rows[0]?.id ? { id: rows[0].id, path: rows[0].path } : null
}

export async function setDefaultFolder(userId: string, folderId: string | null): Promise<Result> {
  if (folderId && !(await ownFolder(userId, folderId))) return { error: "Pick one of your own folders." }
  await db.insert(archivePrefs).values({ userId, folderNodeId: folderId }).onConflictDoUpdate({ target: archivePrefs.userId, set: { folderNodeId: folderId } })
  return {}
}

export async function listCookies(userId: string): Promise<CookieView[]> {
  const rows = await db.select({ id: archiveCookies.id, domain: archiveCookies.domain, createdAt: archiveCookies.createdAt }).from(archiveCookies).where(eq(archiveCookies.userId, userId)).orderBy(archiveCookies.domain)
  return rows.map((r) => ({ id: r.id, domain: r.domain, createdAt: r.createdAt.toISOString() }))
}

// Write-only: the value is sealed and never shown again.
export async function saveCookie(userId: string, domain: string, header: string): Promise<Result> {
  const d = cleanDomain(domain)
  if (!d) return { error: "Enter a site like example.com." }
  if (!parseCookieHeader(header).length) return { error: "Paste the cookie header, like name=value; other=value." }
  if (header.length > 8000) return { error: "That's too long for a cookie header." }
  const valueEnc = encrypt(header.trim())
  await db.insert(archiveCookies).values({ userId, domain: d, valueEnc }).onConflictDoUpdate({ target: [archiveCookies.userId, archiveCookies.domain], set: { valueEnc } })
  return {}
}

export async function deleteCookie(userId: string, id: string) {
  await db.delete(archiveCookies).where(and(eq(archiveCookies.id, id), eq(archiveCookies.userId, userId)))
}

// ---- Pages ----------------------------------------------------------------

export type NewPage = { url: string; title?: string; tags?: string[] }

// Saves pages the member hasn't saved yet and captures each now. `existing` were already saved (their tags are merged).
export async function addPages(userId: string, items: NewPage[], o: { tags?: string[]; folderId?: string | null; intervalMin?: number | null } = {}): Promise<{ added: number; existing: number; ids: string[]; error?: string }> {
  if (o.folderId && !(await ownFolder(userId, o.folderId))) return { added: 0, existing: 0, ids: [], error: "Pick one of your own folders." }
  let added = 0
  let existing = 0
  const ids: string[] = []
  for (const it of items) {
    const url = cleanUrl(it.url)
    if (!url) continue
    const tags = cleanTags([...(it.tags ?? []), ...(o.tags ?? [])])
    const [row] = await db
      .insert(archivePages)
      .values({ userId, url, title: (it.title ?? "").slice(0, 200), site: siteOf(url), tags, folderNodeId: o.folderId ?? null, intervalMin: o.intervalMin ?? null, nextDueAt: o.intervalMin ? new Date(Date.now() + o.intervalMin * 60_000) : null })
      .onConflictDoNothing()
      .returning({ id: archivePages.id })
    if (row) {
      added++
      ids.push(row.id)
      await startCapture(userId, row.id)
    } else {
      existing++
      if (tags.length) await db.execute(sql`update archive_pages set tags = (select coalesce(array_agg(distinct t), '{}') from unnest(tags || ${tags}::text[]) t) where user_id = ${userId} and url = ${url}`)
    }
  }
  return { added, existing, ids }
}

export async function setSchedule(userId: string, id: string, minutes: number | null): Promise<Result> {
  if (minutes !== null && minutes !== 1440 && minutes !== 10_080) return { error: "Pick never, daily or weekly." }
  await db
    .update(archivePages)
    .set({ intervalMin: minutes, nextDueAt: minutes ? new Date(Date.now() + minutes * 60_000) : null })
    .where(and(eq(archivePages.id, id), eq(archivePages.userId, userId)))
  return {}
}

export async function setTags(userId: string, id: string, tags: string[]) {
  await db.update(archivePages).set({ tags: cleanTags(tags).slice(0, MAX_TAGS) }).where(and(eq(archivePages.id, id), eq(archivePages.userId, userId)))
}

export async function setPageCookie(userId: string, id: string, domain: string | null): Promise<Result> {
  const d = domain ? cleanDomain(domain) : null
  if (domain && !d) return { error: "Enter a site like example.com." }
  await db.update(archivePages).set({ cookieDomain: d }).where(and(eq(archivePages.id, id), eq(archivePages.userId, userId)))
  return {}
}

// The page and its snapshot list go; the saved files stay in Files, where the member can delete them.
export async function deletePage(userId: string, id: string) {
  await db.delete(archivePages).where(and(eq(archivePages.id, id), eq(archivePages.userId, userId)))
}

// ---- Capture --------------------------------------------------------------

// Marks the page running (once), moves its next due time on and queues the capture.
export async function startCapture(userId: string, id: string): Promise<Result> {
  const [p] = await db
    .update(archivePages)
    .set({
      lastStatus: "running",
      lastError: null,
      runningAt: new Date(),
      nextDueAt: sql`case when ${archivePages.intervalMin} is null then null else now() + make_interval(mins => ${archivePages.intervalMin}) end`,
    })
    .where(and(eq(archivePages.id, id), eq(archivePages.userId, userId), sql`${archivePages.lastStatus} is distinct from 'running'`))
    .returning({ id: archivePages.id })
  if (!p) return { error: "That page is already being captured." }
  try {
    await enqueueArchive(id)
  } catch {
    await db.update(archivePages).set({ lastStatus: "failed", lastError: "Couldn't queue the capture. Is Redis running?", runningAt: null }).where(eq(archivePages.id, id))
    return { error: "Couldn't queue the capture. Is Redis running?" }
  }
  return {}
}

// After a capture: streak, next due time and, at two failures in a row, the bell and email (claimed first so a retry sends one).
async function settle(p: Page, status: "ok" | "unchanged" | "failed", error: string | null, title?: string) {
  const streak = status === "failed" ? p.failStreak + 1 : 0
  await db
    .update(archivePages)
    .set({
      lastStatus: status,
      lastError: error?.slice(0, 300) ?? null,
      lastRunAt: new Date(),
      runningAt: null,
      failStreak: streak,
      ...(title ? { title } : {}),
      ...(status === "failed" ? {} : { alertedAt: null }),
    })
    .where(eq(archivePages.id, p.id))
  if (streak < 2 || p.alertedAt) return
  const [claimed] = await db.update(archivePages).set({ alertedAt: new Date() }).where(and(eq(archivePages.id, p.id), isNull(archivePages.alertedAt))).returning({ id: archivePages.id })
  if (claimed) await notify(p.userId, "archive_failed", { data: { id: p.id, name: p.title || p.url, streak: String(streak), error: error ?? "" } })
}

// Where a page's files go: <folder>/<site>, the folder being the page's, the member's default or "Web archive".
async function siteFolder(p: Page) {
  const prefs = (await db.select({ id: archivePrefs.folderNodeId }).from(archivePrefs).where(eq(archivePrefs.userId, p.userId)))[0]
  for (const id of [p.folderNodeId, prefs?.id]) {
    if (id && (await ownFolder(p.userId, id))) {
      const dir = await db.transaction((tx) => mkdirp(tx, p.userId, id, [p.site]))
      if (!("error" in dir)) return dir.id
    }
  }
  const dir = await db.transaction((tx) => mkdirp(tx, p.userId, null, [DEFAULT_FOLDER, p.site]))
  if ("error" in dir) throw new Error(dir.error)
  return dir.id
}

async function put(p: Page, parentId: string | null, name: string, body: Buffer, mime: string) {
  const r = await storeFile({ me: p.userId, at: { ownerId: p.userId, parentId }, name, existing: null, body: new Response(new Uint8Array(body)).body, declared: body.length, mime, prefix: "archive" })
  if ("error" in r) throw new Error(r.error.message ?? (r.error.code === "full" ? "Storage is full." : "Couldn't save the files."))
  return r.nodeId
}

// ponytail: a capture that fails after some files are saved leaves them in Files (no snapshot row points at them).
export async function runCapture(pageId: string) {
  const [p] = await db.select().from(archivePages).where(eq(archivePages.id, pageId))
  if (!p || p.lastStatus !== "running") return
  try {
    const s = await getSettings()
    if (!browserUrl(s)) throw new Error("Needs the browser service. Ask an admin to set it up.")
    const u = new URL(p.url)
    await checkAddress(u.hostname, Number(u.port) || (u.protocol === "http:" ? 80 : 443), !blockPrivateHosts())

    const saved = await db.select().from(archiveCookies).where(eq(archiveCookies.userId, p.userId))
    const domain = p.cookieDomain ?? cookieDomainFor(u.hostname, saved.map((c) => c.domain))
    const row = saved.find((c) => c.domain === domain)
    const cookies = row ? parseCookieHeader(decrypt(row.valueEnc) ?? "") : []

    const got = await capture(browserUrl(s), p.url, cookies)
    const body = `# ${got.title || p.url}\n\n<${p.url}>\n\n${got.text}\n`
    const hash = textHash(got.text)
    const [last] = await db.select({ hash: archiveSnapshots.textHash }).from(archiveSnapshots).where(eq(archiveSnapshots.pageId, p.id)).orderBy(desc(archiveSnapshots.capturedAt)).limit(1)
    if (last?.hash === hash) return await settle(p, "unchanged", null)

    const at = new Date()
    const title = got.title || p.title || p.site
    const dir = await siteFolder(p)
    const htmlNodeId = await put(p, dir, fileName(title, at, "html"), Buffer.from(got.html), "text/html")
    const pdfNodeId = await put(p, dir, fileName(title, at, "pdf"), got.pdf, "application/pdf")
    const pngNodeId = await put(p, dir, fileName(title, at, "png"), got.png, "image/png")
    const textNodeId = await put(p, dir, fileName(title, at, "md"), Buffer.from(body), "text/markdown")
    await db.insert(archiveSnapshots).values({ pageId: p.id, capturedAt: at, title, textHash: hash, htmlNodeId, pdfNodeId, pngNodeId, textNodeId, bytes: got.html.length + got.pdf.length + got.png.length + Buffer.byteLength(body) })
    await settle(p, "ok", null, title)
  } catch (e) {
    await settle(p, "failed", explain(e as Error))
  }
}

// What a person can act on: puppeteer's messages are long and technical.
function explain(e: Error) {
  const m = e.message || "The capture failed."
  if (/ERR_NAME_NOT_RESOLVED/.test(m)) return "The site's address wasn't found."
  if (/ERR_CONNECTION_REFUSED|ECONNREFUSED/.test(m)) return /ws:|wss:|browserWSEndpoint|3000/.test(m) ? "Can't reach the browser service." : "The site refused the connection."
  if (/Timeout|timed out/i.test(m)) return "The page took too long to load."
  if (/WebSocket|browserWSEndpoint|Unexpected server response/i.test(m)) return "Can't reach the browser service. Check its address and token."
  return m.split("\n")[0]
}

// ---- Tick -----------------------------------------------------------------

// Every minute (worker job "archive-tick"): pages that are due go to the queue.
export async function tick() {
  await db
    .update(archivePages)
    .set({ lastStatus: "failed", lastError: "The capture didn't finish.", runningAt: null })
    .where(and(eq(archivePages.lastStatus, "running"), sql`${archivePages.runningAt} < now() - ${HUNG}`))
  const s = await getSettings()
  if (!s.archiverToolEnabled || !browserUrl(s)) return 0
  const due = await db
    .select({ id: archivePages.id, userId: archivePages.userId })
    .from(archivePages)
    .where(and(sql`${archivePages.intervalMin} is not null`, sql`${archivePages.nextDueAt} <= now()`, sql`${archivePages.lastStatus} is distinct from 'running'`))
    .limit(20)
  let n = 0
  for (const d of due) if (!(await startCapture(d.userId, d.id)).error) n++
  return n
}

// The card on More.
export async function archiveStatus(userId: string, now: number): Promise<{ text: string; failing?: boolean }> {
  const state = await browserStatus()
  if (state !== "ok") return { text: "Needs the browser service", failing: false }
  const [r] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number), failed: sql<number>`count(*) filter (where ${archivePages.lastStatus} = 'failed')`.mapWith(Number), last: max(archivePages.lastRunAt) })
    .from(archivePages)
    .where(eq(archivePages.userId, userId))
  if (!r.n) return { text: "No pages saved" }
  const when = r.last ? `Last capture ${ago(r.last.toISOString(), now)}` : "No capture yet"
  return { text: `${r.n === 1 ? "1 page" : `${r.n} pages`} · ${when}`, failing: r.failed > 0 }
}
