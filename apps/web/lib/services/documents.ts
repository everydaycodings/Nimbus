// Documents: a view over the owner's files with type, sender, date, amount and expiry (the worker
// fills them in, scripts/documents.ts). The /api/v1/documents routes and, later, the pages call this.
// Documents shared with someone show to them read-only, confirmed ones only.
import "server-only"

import { createHash, randomUUID } from "node:crypto"

import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm"
import { PDFDocument } from "pdf-lib"
import sharp from "sharp"

import { fail, withMember } from "@/lib/api"
import { db } from "@/lib/db"
import { docSenders, docTypes, docWatch, documents, nodes } from "@/lib/db/schema"
import { recordSaved } from "@/lib/activity"
import { notify } from "@/lib/notify"
import { checkStorage, spaceLeft } from "@/lib/quota"
import { enqueueDerive } from "@/lib/redis"
import { putObject, getStream } from "@/lib/s3"
import type { Me } from "@/lib/session"
import { getSettings } from "@/lib/signup"
import { cleanName, GONE } from "@/lib/tree-ops"
import { mkdirp, pruneVersions, saveUploaded } from "@/lib/uploads"
import type {
  DocSender,
  DocType,
  DocWatchFolder,
  DocumentDetail,
  DocumentItem,
  DocumentPatch,
  DocumentsQuery,
  DocumentsSummary,
  DocumentsTotalRow,
  DocumentsTotalsQuery,
  DocField,
} from "@nimbus/shared/documents-api"

type Result = { error?: string }

// Every documents route: a member, and the admin hasn't turned Documents off.
export const withDocs = (fn: (me: Me) => Promise<Response>) =>
  withMember(async (me) =>
    (await getSettings()).documentsEnabled ? fn(me) : fail(404, "not-found", "Documents are turned off.")
  )

const iso = (d: unknown) => new Date(d as string).toISOString()

// ---- Reading ----

type Raw = {
  id: string
  name: string
  mime: string | null
  size: string
  version: string | null
  thumb: string | null
  folder_id: string | null
  updated_at: string
  owner_id: string
  owner_name: string
  status: DocumentItem["status"]
  source: DocumentItem["source"]
  type_id: string | null
  type_name: string | null
  sender_id: string | null
  sender_name: string | null
  doc_date: string | null
  amount: number | null
  currency: string | null
  expires_at: string | null
  remind_override: number | null
  remind_days: number | null
  notes: string | null
  fields: Record<string, string>
  guess: DocumentItem["guess"]
  dup_id: string | null
  dup_name: string | null
  days_left: number | null
  text?: string | null
  total: string
}

const toItem = (r: Raw, me: string): DocumentItem => ({
  id: r.id,
  name: r.name,
  mime: r.mime,
  size: Number(r.size),
  version: r.version,
  thumb: r.thumb,
  folderId: r.folder_id,
  updatedAt: iso(r.updated_at),
  role: r.owner_id === me ? "owner" : "viewer",
  owner: r.owner_id === me ? null : r.owner_name,
  status: r.status,
  source: r.source,
  typeId: r.type_id,
  typeName: r.type_name,
  senderId: r.sender_id,
  senderName: r.sender_name,
  docDate: r.doc_date,
  amount: r.amount,
  currency: r.currency,
  expiresAt: r.expires_at,
  remindDays: r.remind_days,
  remindOverride: r.remind_override,
  notes: r.notes,
  fields: r.fields,
  guess: r.guess,
  dupOf: r.dup_id ? { id: r.dup_id, name: r.dup_name! } : null,
  missing: (
    [
      ["type", r.type_id],
      ["sender", r.sender_id],
      ["date", r.doc_date],
      ["amount", r.amount],
      ["expiry", r.expires_at],
    ] as [DocField, unknown][]
  )
    .filter(([, v]) => v === null)
    .map(([k]) => k),
  daysLeft: r.days_left,
})

const MISSING: Record<DocField, string> = {
  type: "d.type_id is null",
  sender: "d.sender_id is null",
  date: "d.doc_date is null",
  amount: "d.amount is null",
  expiry: "d.expires_at is null",
}
// Inside its reminder window (30 days when none is set).
const LEAD = sql`coalesce(d.remind_days, t.remind_days, 30)`
const SORT = {
  date: "d.doc_date",
  name: "lower(n.name)",
  amount: "d.amount",
  expires: "d.expires_at",
  added: "n.created_at",
} as const

export type ListOpts = DocumentsQuery & {
  id?: string
  /** The summary strip: soon, or expired within the last 30 days. */
  strip?: boolean
  withText?: boolean
}

async function query(me: Me, o: ListOpts) {
  const likeQ = o.q?.trim().slice(0, 200)
  const status = o.status
  const w: SQL[] = [sql`n.trashed_at is null and n.vault_id is null`]
  // Mine, or confirmed ones inside what's shared with me.
  const mineOnly = status === "review" || status === "dismissed" || o.shared === "0" || o.strip
  w.push(
    mineOnly
      ? sql`d.owner_id = ${me.id}`
      : sql`(d.owner_id = ${me.id} or (d.status = 'confirmed' and n.id in (select id from shared)))`
  )
  w.push(status ? sql`d.status = ${status}` : sql`d.status <> 'dismissed'`)
  if (o.id) w.push(sql`n.id = ${o.id}`)
  if (o.type) w.push(sql`d.type_id = ${o.type}`)
  if (o.sender) w.push(sql`d.sender_id = ${o.sender}`)
  if (o.from) w.push(sql`d.doc_date >= ${o.from}`)
  if (o.to) w.push(sql`d.doc_date <= ${o.to}`)
  if (o.year) w.push(sql`extract(year from d.doc_date) = ${o.year}`)
  if (o.minAmount !== undefined) w.push(sql`d.amount >= ${o.minAmount}`)
  if (o.maxAmount !== undefined) w.push(sql`d.amount <= ${o.maxAmount}`)
  if (o.currency) w.push(sql`d.currency = ${o.currency.toUpperCase()}`)
  if (o.strip)
    w.push(sql`d.expires_at between current_date - 30 and current_date + ${LEAD}`)
  else if (o.expiring === "soon")
    w.push(sql`d.expires_at between current_date and current_date + ${LEAD}`)
  else if (o.expiring === "expired") w.push(sql`d.expires_at < current_date`)
  else if (o.expiring === "any") w.push(sql`d.expires_at is not null`)
  for (const m of (o.missing ?? "").split(",").filter((m): m is DocField => m in MISSING))
    w.push(sql.raw(MISSING[m]))
  if (likeQ) {
    const like = `%${likeQ.replace(/[%_\\]/g, "\\$&").toLowerCase()}%`
    w.push(sql`(lower(n.name) like ${like} or lower(s.name) like ${like} or lower(d.notes) like ${like}
      or c.tsv @@ websearch_to_tsquery('simple', ${likeQ}))`)
  }
  const sort = sql.raw(SORT[o.sort ?? "date"])
  const dir = sql.raw(o.order === "asc" ? "asc" : "desc")
  const limit = o.limit ?? 100
  const rows = await db.execute<Raw>(sql`
    with recursive shared as (
      select n.id from nodes n join shares s on s.node_id = n.id and s.grantee_id = ${me.id}
        and (s.expires_at is null or s.expires_at > now())
      where n.trashed_at is null and n.vault_id is null
      union
      select c.id from nodes c join shared on c.parent_id = shared.id where c.trashed_at is null
    )
    select n.id, n.name, n.mime, n.size, n.current_version_id as version, fv.thumb, n.parent_id as folder_id,
      n.updated_at, d.owner_id, ou.name as owner_name, d.status, d.source,
      d.type_id, t.name as type_name, d.sender_id, s.name as sender_name,
      d.doc_date::text, d.amount::float8, d.currency, d.expires_at::text,
      d.remind_days as remind_override, coalesce(d.remind_days, t.remind_days) as remind_days,
      d.notes, d.fields, d.guess, d.dup_of as dup_id, dn.name as dup_name,
      (d.expires_at - current_date)::int as days_left,
      ${o.withText ? sql`left(c.body, 20000)` : sql`null`} as text,
      count(*) over() as total
    from documents d
    join nodes n on n.id = d.node_id
    join "user" ou on ou.id = d.owner_id
    left join file_versions fv on fv.id = n.current_version_id
    left join node_content c on c.node_id = n.id and c.version_id = n.current_version_id
    left join doc_types t on t.id = d.type_id
    left join doc_senders s on s.id = d.sender_id
    left join nodes dn on dn.id = d.dup_of and dn.trashed_at is null
    where ${sql.join(w, sql` and `)}
    order by ${sort} ${dir} nulls last, n.created_at desc, n.id
    limit ${limit} offset ${o.cursor ?? 0}`)
  return {
    items: rows.map((r) => ({ ...toItem(r, me.id), text: r.text ?? null })),
    total: Number(rows[0]?.total ?? 0),
    nextCursor: rows.length === limit ? (o.cursor ?? 0) + limit : null,
  }
}

export async function listDocuments(me: Me, o: DocumentsQuery) {
  const r = await query(me, o)
  return { items: r.items.map(({ text, ...i }) => (void text, i)), total: r.total, nextCursor: r.nextCursor }
}

export async function getDocument(me: Me, id: string): Promise<DocumentDetail | null> {
  // Mine (not dismissed) or shared with me; else my dismissed one, so Undo can open it.
  const [row] = (await query(me, { id, withText: true, limit: 1 })).items
  if (row) return row
  const [own] = (await query(me, { id, status: "dismissed", withText: true, limit: 1 })).items
  return own ?? null
}

export async function summary(me: Me): Promise<DocumentsSummary> {
  const [c] = await db.execute<{ review: number; total: number }>(sql`
    select count(*) filter (where d.status = 'review')::int as review,
      count(*) filter (where d.status <> 'dismissed')::int as total
    from documents d join nodes n on n.id = d.node_id
    where d.owner_id = ${me.id} and n.trashed_at is null and n.vault_id is null`)
  const { items } = await query(me, { strip: true, sort: "expires", order: "asc", limit: 10 })
  return { review: c.review, total: c.total, expiring: items.map(({ text, ...i }) => (void text, i)) }
}

export async function totals(me: Me, q: DocumentsTotalsQuery): Promise<DocumentsTotalRow[]> {
  const key = q.by === "sender" ? sql`d.sender_id` : sql`d.type_id`
  const label = q.by === "sender" ? sql`coalesce(s.name, 'No sender')` : sql`coalesce(t.name, 'No type')`
  const period = sql.raw(q.period === "month" ? `to_char(d.doc_date, 'YYYY-MM')` : `to_char(d.doc_date, 'YYYY')`)
  const rows = await db.execute<{ period: string; key: string | null; label: string; currency: string; total: number; count: number }>(sql`
    select ${period} as period, ${key} as key, ${label} as label, coalesce(d.currency, '') as currency,
      sum(d.amount)::float8 as total, count(*)::int as count
    from documents d join nodes n on n.id = d.node_id
    left join doc_types t on t.id = d.type_id
    left join doc_senders s on s.id = d.sender_id
    where d.owner_id = ${me.id} and d.status <> 'dismissed' and n.trashed_at is null and n.vault_id is null
      and d.amount is not null and d.doc_date is not null
      ${q.year ? sql`and extract(year from d.doc_date) = ${q.year}` : sql``}
    group by 1, 2, 3, 4 order by 1 desc, 5 desc`)
  return rows.map((r) => ({ ...r }))
}

// ---- Changing ----

async function typeAllowed(me: Me, id: string) {
  const [t] = await db
    .select({ id: docTypes.id })
    .from(docTypes)
    .where(and(eq(docTypes.id, id), sql`(${docTypes.ownerId} is null or ${docTypes.ownerId} = ${me.id})`))
  return Boolean(t)
}
async function senderAllowed(me: Me, id: string) {
  const [s] = await db
    .select({ id: docSenders.id })
    .from(docSenders)
    .where(and(eq(docSenders.id, id), eq(docSenders.ownerId, me.id)))
  return Boolean(s)
}

// The ids of mine among `ids` that are documents.
const mine = async (me: Me, ids: string[]) =>
  ids.length
    ? (
        await db
          .select({ id: documents.nodeId })
          .from(documents)
          .where(and(eq(documents.ownerId, me.id), inArray(documents.nodeId, ids)))
      ).map((r) => r.id)
    : []

// Confirming teaches the sender: the text that was matched (when it isn't the name) becomes a pattern.
async function confirm(me: Me, ids: string[]) {
  if (!ids.length) return
  await db.execute(sql`
    update doc_senders s set patterns = array_append(s.patterns, g.m)
    from (select distinct d.sender_id, lower(d.guess->>'senderMatch') as m from documents d
      where d.node_id in ${ids} and d.owner_id = ${me.id} and d.sender_id is not null
        and d.guess->>'senderMatch' is not null) g
    where s.id = g.sender_id and s.owner_id = ${me.id} and lower(s.name) <> g.m and not (g.m = any(s.patterns))`)
  await db
    .update(documents)
    .set({ status: "confirmed", updatedAt: new Date() })
    .where(and(eq(documents.ownerId, me.id), inArray(documents.nodeId, ids)))
}

export async function senderByName(me: Me, raw: string) {
  const name = raw.trim().replace(/\s+/g, " ").slice(0, 100)
  const [s] = await db.execute<{ id: string }>(sql`
    insert into doc_senders (owner_id, name, patterns) values (${me.id}, ${name}, array[${name.toLowerCase()}]::text[])
    on conflict (owner_id, lower(name)) do update set name = doc_senders.name returning id`)
  return s.id
}

export async function updateDocument(me: Me, id: string, p: DocumentPatch): Promise<Result & { item?: DocumentDetail }> {
  const [have] = await mine(me, [id])
  if (!have) return { error: "That isn't one of your documents." }
  if (p.typeId && !(await typeAllowed(me, p.typeId))) return { error: "That type is gone." }
  if (p.senderId && !(await senderAllowed(me, p.senderId))) return { error: "That sender is gone." }
  const senderId = p.senderName?.trim()
    ? await senderByName(me, p.senderName)
    : p.senderName === null
      ? null
      : p.senderId
  const set: Partial<typeof documents.$inferInsert> = { updatedAt: new Date() }
  if (p.typeId !== undefined) set.typeId = p.typeId
  if (senderId !== undefined) set.senderId = senderId
  if (p.docDate !== undefined) set.docDate = p.docDate
  if (p.amount !== undefined) set.amount = p.amount
  if (p.currency !== undefined) set.currency = p.currency?.toUpperCase() ?? null
  if (p.expiresAt !== undefined) {
    set.expiresAt = p.expiresAt
    // A new date starts a new reminder.
    set.remindedAt = null
  }
  if (p.remindDays !== undefined) set.remindDays = p.remindDays
  if (p.notes !== undefined) set.notes = p.notes?.trim() || null
  if (p.fields !== undefined) set.fields = p.fields
  if (p.status && p.status !== "confirmed") set.status = p.status
  await db.update(documents).set(set).where(eq(documents.nodeId, id))
  if (p.status === "confirmed") await confirm(me, [id])
  return { item: (await getDocument(me, id)) ?? undefined }
}

// Marks files as documents (and brings dismissed ones back). The worker reads the new ones.
export async function markDocuments(me: Me, ids: string[]): Promise<Result & { marked?: number }> {
  const files = ids.length
    ? await db
        .select({ id: nodes.id })
        .from(nodes)
        .where(and(eq(nodes.ownerId, me.id), eq(nodes.kind, "file"), isNull(nodes.trashedAt), isNull(nodes.vaultId), inArray(nodes.id, ids)))
    : []
  if (!files.length) return { error: "Those files are gone." }
  await db
    .insert(documents)
    .values(files.map((f) => ({ nodeId: f.id, ownerId: me.id, source: "manual" as const })))
    .onConflictDoUpdate({
      target: documents.nodeId,
      set: { status: "review", source: "manual", updatedAt: new Date() },
      setWhere: eq(documents.status, "dismissed"),
    })
  return { marked: files.length }
}

export async function bulk(
  me: Me,
  b: { ids: string[]; typeId?: string | null; senderId?: string | null; confirm?: boolean }
): Promise<Result & { updated?: number }> {
  if (b.typeId && !(await typeAllowed(me, b.typeId))) return { error: "That type is gone." }
  if (b.senderId && !(await senderAllowed(me, b.senderId))) return { error: "That sender is gone." }
  const ids = await mine(me, b.ids)
  if (!ids.length) return { error: "Those documents are gone." }
  const set: Partial<typeof documents.$inferInsert> = { updatedAt: new Date() }
  if (b.typeId !== undefined) set.typeId = b.typeId
  if (b.senderId !== undefined) set.senderId = b.senderId
  await db.update(documents).set(set).where(inArray(documents.nodeId, ids))
  if (b.confirm) await confirm(me, ids)
  return { updated: ids.length }
}

// ---- Types, senders, watch folders ----

export async function listTypes(me: Me): Promise<DocType[]> {
  const rows = await db
    .select()
    .from(docTypes)
    .where(sql`${docTypes.ownerId} is null or ${docTypes.ownerId} = ${me.id}`)
    .orderBy(sql`${docTypes.ownerId} is not null`, sql`lower(${docTypes.name})`)
  return rows.map((t) => ({ id: t.id, key: t.key, name: t.name, preset: !t.ownerId, remindDays: t.remindDays }))
}

const isClash = (e: unknown) => (e as { code?: string; cause?: { code?: string } })?.code === "23505" || (e as { cause?: { code?: string } })?.cause?.code === "23505"

export async function saveType(me: Me, b: { name: string; remindDays: number | null }, id?: string): Promise<Result & { type?: DocType }> {
  try {
    if (id) {
      const [t] = await db
        .update(docTypes)
        .set({ name: b.name, remindDays: b.remindDays })
        .where(and(eq(docTypes.id, id), eq(docTypes.ownerId, me.id)))
        .returning()
      if (!t) return { error: "Only your own types can be changed." }
      return { type: { id: t.id, key: null, name: t.name, preset: false, remindDays: t.remindDays } }
    }
    const [t] = await db.insert(docTypes).values({ ownerId: me.id, name: b.name, remindDays: b.remindDays }).returning()
    return { type: { id: t.id, key: null, name: t.name, preset: false, remindDays: t.remindDays } }
  } catch (e) {
    if (isClash(e)) return { error: "A type with that name already exists." }
    throw e
  }
}

export async function deleteType(me: Me, id: string): Promise<Result> {
  const gone = await db.delete(docTypes).where(and(eq(docTypes.id, id), eq(docTypes.ownerId, me.id))).returning({ id: docTypes.id })
  return gone.length ? {} : { error: "Only your own types can be deleted." }
}

export async function listSenders(me: Me): Promise<DocSender[]> {
  const rows = await db.execute<{ id: string; name: string; patterns: string[]; count: number }>(sql`
    select s.id, s.name, s.patterns,
      (select count(*)::int from documents d where d.sender_id = s.id and d.status <> 'dismissed') as count
    from doc_senders s where s.owner_id = ${me.id} order by lower(s.name)`)
  return rows.map((r) => ({ ...r }))
}

export async function createSender(me: Me, name: string): Promise<Result & { sender?: DocSender }> {
  const id = await senderByName(me, name)
  return { sender: (await listSenders(me)).find((s) => s.id === id) }
}

export async function updateSender(me: Me, id: string, b: { name?: string; patterns?: string[] }): Promise<Result & { sender?: DocSender }> {
  const set: Partial<typeof docSenders.$inferInsert> = {}
  if (b.name) set.name = b.name.trim().replace(/\s+/g, " ")
  if (b.patterns) set.patterns = [...new Set(b.patterns.map((p) => p.trim().toLowerCase()).filter(Boolean))]
  try {
    const [s] = await db
      .update(docSenders)
      .set(set)
      .where(and(eq(docSenders.id, id), eq(docSenders.ownerId, me.id)))
      .returning({ id: docSenders.id })
    if (!s) return { error: "That sender is gone." }
  } catch (e) {
    if (isClash(e)) return { error: "A sender with that name already exists. Merge them instead." }
    throw e
  }
  return { sender: (await listSenders(me)).find((s) => s.id === id) }
}

export async function deleteSender(me: Me, id: string): Promise<Result> {
  const gone = await db.delete(docSenders).where(and(eq(docSenders.id, id), eq(docSenders.ownerId, me.id))).returning({ id: docSenders.id })
  return gone.length ? {} : { error: "That sender is gone." }
}

// `from` goes into `into`: its documents move, its name and patterns become patterns of `into`.
export async function mergeSenders(me: Me, from: string, into: string): Promise<Result> {
  if (from === into) return { error: "Pick two different senders." }
  return db.transaction(async (tx) => {
    const found = await tx
      .select()
      .from(docSenders)
      .where(and(eq(docSenders.ownerId, me.id), inArray(docSenders.id, [from, into])))
    const a = found.find((s) => s.id === from)
    const b = found.find((s) => s.id === into)
    if (!a || !b) return { error: "That sender is gone." }
    await tx.update(documents).set({ senderId: into }).where(eq(documents.senderId, from))
    await tx
      .update(docSenders)
      .set({ patterns: [...new Set([...b.patterns, ...a.patterns, a.name.toLowerCase()])].filter((p) => p !== b.name.toLowerCase()) })
      .where(eq(docSenders.id, into))
    await tx.delete(docSenders).where(eq(docSenders.id, from))
    return {}
  })
}

export async function listWatch(me: Me): Promise<DocWatchFolder[]> {
  const rows = await db.execute<{ id: string; name: string; path: string }>(sql`
    select n.id, n.name,
      (with recursive up as (
        select id, parent_id, name, 0 as d from nodes where id = n.id
        union all
        select p.id, p.parent_id, p.name, up.d + 1 from nodes p join up on p.id = up.parent_id
      ) select string_agg(name, '/' order by d desc) from up) as path
    from doc_watch w join nodes n on n.id = w.node_id
    where w.owner_id = ${me.id} and n.trashed_at is null order by lower(n.name)`)
  return rows.map((r) => ({ ...r }))
}

export async function addWatch(me: Me, folderId: string): Promise<Result> {
  const [f] = await db
    .select({ id: nodes.id })
    .from(nodes)
    .where(and(eq(nodes.id, folderId), eq(nodes.ownerId, me.id), eq(nodes.kind, "folder"), isNull(nodes.trashedAt), isNull(nodes.vaultId)))
  if (!f) return { error: GONE }
  await db.insert(docWatch).values({ ownerId: me.id, nodeId: folderId }).onConflictDoNothing()
  return {}
}

export async function removeWatch(me: Me, folderId: string): Promise<Result> {
  await db.delete(docWatch).where(and(eq(docWatch.ownerId, me.id), eq(docWatch.nodeId, folderId)))
  return {}
}

// ---- Filing ----

// Documents/<year>, made when missing and tagged as the Documents system folder.
export async function uploadTarget(me: Me, date?: string) {
  const year = String(date && /^\d{4}/.test(date) ? date.slice(0, 4) : new Date().getFullYear())
  const dir = await mkdirp(db, me.id, null, ["Documents", year], undefined, "documents")
  if ("error" in dir) return { error: dir.error }
  return { folderId: dir.id!, path: `Documents/${year}` }
}

const A4 = [595, 842]
const MAX_MERGE = 300 * 1024 ** 2

// Images and PDFs, in the order given, into one new PDF in Documents/<year>.
export async function mergePdf(me: Me, ids: string[], rawName?: string): Promise<Result & { id?: string; name?: string; folderId?: string }> {
  const order = [...new Set(ids)]
  const rows = order.length
    ? await db
        .select({ id: nodes.id, name: nodes.name, mime: nodes.mime, key: nodes.s3Key, size: nodes.size })
        .from(nodes)
        .where(and(eq(nodes.ownerId, me.id), eq(nodes.kind, "file"), isNull(nodes.trashedAt), isNull(nodes.vaultId), inArray(nodes.id, order)))
    : []
  const files = order.flatMap((id) => rows.find((r) => r.id === id) ?? [])
  if (files.length < 1 || files.length !== order.length) return { error: "Some of those files are gone." }
  if (files.reduce((n, f) => n + f.size, 0) > MAX_MERGE) return { error: "Those files are too big to merge (300 MB at most)." }
  const out = await PDFDocument.create()
  for (const f of files) {
    const bytes = new Uint8Array(await new Response(await getStream(f.key!)).arrayBuffer())
    if (f.mime === "application/pdf" || /\.pdf$/i.test(f.name)) {
      try {
        const src = await PDFDocument.load(bytes, { ignoreEncryption: false })
        for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p)
      } catch {
        return { error: `“${f.name}” can't be read as a PDF.` }
      }
    } else {
      let jpg: Buffer
      try {
        jpg = await sharp(bytes, { limitInputPixels: 200_000_000 })
          .rotate()
          .resize(3000, 3000, { fit: "inside", withoutEnlargement: true })
          .flatten({ background: "#fff" })
          .jpeg({ quality: 88 })
          .toBuffer()
      } catch {
        return { error: `“${f.name}” isn't a PDF or a picture that can be merged.` }
      }
      const img = await out.embedJpg(jpg)
      // Fit the picture on an A4 page turned the way the picture is.
      const [pw, ph] = img.width > img.height ? [A4[1], A4[0]] : A4
      const s = Math.min(pw / img.width, ph / img.height)
      const page = out.addPage([img.width * s, img.height * s])
      page.drawImage(img, { x: 0, y: 0, width: img.width * s, height: img.height * s })
    }
  }
  const pdf = await out.save()
  const left = await spaceLeft(me.id)
  if (left !== null && pdf.length > left) return { error: "There isn't enough storage space left for the merged PDF." }
  const target = await uploadTarget(me)
  if ("error" in target) return target
  const clean = cleanName((rawName?.trim() || `Merged ${new Date().toISOString().slice(0, 10)}`).replace(/(\.pdf)?$/i, ".pdf"))
  if ("error" in clean) return clean
  const key = randomUUID().replaceAll("-", "")
  await putObject(key, pdf, "application/pdf")
  const saved = await db.transaction((tx) =>
    saveUploaded(tx, {
      ownerId: me.id,
      parentId: target.folderId,
      name: clean.name,
      version: {
        s3Key: key,
        size: pdf.length,
        mime: "application/pdf",
        sha256: createHash("sha256").update(pdf).digest("hex"),
        uploadedBy: me.id,
      },
      onConflict: "keep",
    })
  )
  if (!saved.nodeId) return { error: saved.error ?? "Couldn't save the merged PDF." }
  await recordSaved(saved.nodeId, saved.versionId!, me.id)
  await pruneVersions(saved.nodeId)
  await checkStorage(me.id)
  await enqueueDerive(saved.versionId!)
  // It is a document: the indexer reads it next.
  await markDocuments(me, [saved.nodeId])
  const [n] = await db.select({ name: nodes.name }).from(nodes).where(eq(nodes.id, saved.nodeId))
  return { id: saved.nodeId, name: n.name, folderId: target.folderId }
}

// Years that have a document (by document date), newest first: the page's year filter.
export async function years(me: Me): Promise<number[]> {
  const rows = await db.execute<{ y: number }>(sql`
    select distinct extract(year from d.doc_date)::int as y from documents d join nodes n on n.id = d.node_id
    where d.owner_id = ${me.id} and d.status <> 'dismissed' and d.doc_date is not null
      and n.trashed_at is null and n.vault_id is null order by 1 desc`)
  return rows.map((r) => r.y)
}

// ---- Reminders ----

// The daily job: a bell notice (and the phone's push) once per document, when its expiry or due date
// comes inside its lead time (its own, else its type's; none means never). Changing the expiry starts a new
// reminder (updateDocument clears reminded_at). Ones that expired more than a week ago are skipped, so a
// backfill of old files doesn't bury the bell.
export async function remindExpiring() {
  if (!(await getSettings()).documentsEnabled) return 0
  const due = await db.execute<{ id: string; owner: string; days: number }>(sql`
    select d.node_id as id, d.owner_id as owner, (d.expires_at - current_date)::int as days
    from documents d
    join nodes n on n.id = d.node_id
    left join doc_types t on t.id = d.type_id
    where d.status <> 'dismissed' and d.reminded_at is null and d.expires_at is not null
      and n.trashed_at is null and n.vault_id is null
      and d.expires_at between current_date - 7 and current_date + coalesce(d.remind_days, t.remind_days, -1)
    limit 500`)
  for (const r of due) {
    // Marked first: a failed notice is not sent twice, and the job's retry doesn't repeat the others.
    const [claimed] = await db
      .update(documents)
      .set({ remindedAt: new Date() })
      .where(and(eq(documents.nodeId, r.id), isNull(documents.remindedAt)))
      .returning({ id: documents.nodeId })
    if (!claimed) continue
    await notify(r.owner, "document_expiring", {
      nodeId: r.id,
      data: { days: String(Math.max(r.days, 0)), what: r.days < 0 ? "expired" : "soon" },
    })
  }
  return due.length
}
