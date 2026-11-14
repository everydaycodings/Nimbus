// Documents: finds the files that count as documents (PDFs, scanned pictures, files in a watched
// or Documents folder, files someone marked) once the indexer has their text, guesses their type,
// sender, date, amount and expiry, and files them as "review". Old files are picked up the same
// way, a batch a minute, so a backfill is just a long sweep. Never touches confirmed or dismissed rows.
// `npm run worker` calls docsSweep() after the indexer's. Run: node --env-file=.env.local scripts/documents.ts
import { extractFields, type KnownSender } from "@nimbus/shared/documents"

import { CLIP_MIN_SIM, ml, mlBase } from "../lib/ml.ts"
import { sql } from "./indexer.ts"

const BATCH = 100

// What Health shows, written to Redis by the worker after each sweep.
export const docsStatus = { enabled: true, backlog: 0, documents: 0, review: 0, lastError: null as string | null }

type Row = {
  id: string
  owner: string
  v: string
  name: string
  created: Date
  sha: string | null
  body: string
}

// Files that count as documents and still need their guesses: no row yet, or a row still in review for an
// older version. (A watch or Documents folder is any ancestor, for anything but video and audio; marked files have a row from the start.)
const candidates = () => sql`
  from nodes n
  join file_versions fv on fv.id = n.current_version_id and fv.enc_key is null
  join "user" u on u.id = n.owner_id and u.status = 'active'
  join node_content c on c.node_id = n.id and c.version_id = n.current_version_id
  left join documents d on d.node_id = n.id
  where n.kind = 'file' and n.trashed_at is null and n.vault_id is null
    and (d.node_id is null or (d.status = 'review' and d.version_id is distinct from n.current_version_id))
    and (n.mime = 'application/pdf' or n.name ~* '\\.pdf$' or fv.smart && array['documents', 'receipts']
      or d.source = 'manual'
      or (coalesce(n.mime, '') !~ '^(video|audio)/' and exists (
        with recursive up as (
          select id, parent_id, system_kind from nodes where id = n.parent_id
          union all
          select p.id, p.parent_id, p.system_kind from nodes p join up on p.id = up.parent_id
        ) select 1 from up where up.system_kind = 'documents'
          or up.id in (select node_id from doc_watch where owner_id = n.owner_id))))`

const typeIds = async () =>
  new Map((await sql<{ key: string; id: string }[]>`select key, id from doc_types where owner_id is null`).map((t) => [t.key, t.id]))

// The earlier file that looks like this one: same content, or same sender, date and amount.
const markDuplicate = (id: string, sha: string | null) => sql`
  update documents d set dup_of = (
    select o.node_id from documents o
    join nodes m on m.id = o.node_id and m.trashed_at is null
    join file_versions ov on ov.id = m.current_version_id
    where o.owner_id = d.owner_id and o.node_id <> d.node_id and o.status <> 'dismissed'
      and (m.created_at, m.id) < (select x.created_at, x.id from nodes x where x.id = d.node_id)
      and ((${sha}::text is not null and ov.sha256 = ${sha})
        or (d.sender_id is not null and o.sender_id = d.sender_id and o.doc_date = d.doc_date and o.amount = d.amount))
    order by m.created_at limit 1)
  where d.node_id = ${id}`
const markLater = (id: string, sha: string | null) => sql`
  update documents d set dup_of = ${id} from nodes m, file_versions v, documents me, nodes mn
  where me.node_id = ${id} and mn.id = ${id} and d.node_id = m.id and v.id = m.current_version_id
    and d.owner_id = me.owner_id and d.node_id <> me.node_id and d.dup_of is null and d.status <> 'dismissed'
    and (m.created_at, m.id) > (mn.created_at, mn.id)
    and ((${sha}::text is not null and v.sha256 = ${sha})
      or (me.sender_id is not null and d.sender_id = me.sender_id and d.doc_date = me.doc_date and d.amount = me.amount))`

async function file(f: Row, types: Map<string, string>, known: Map<string, KnownSender[]>) {
  const senders = known.get(f.owner) ?? []
  const ex = extractFields(f.body, f.name, senders)
  let senderId = ex.senderId
  if (!senderId && ex.senderName) {
    // A new sender learned from the text; the list is editable (rename, merge) on the Documents settings.
    const [s] = await sql<{ id: string; name: string; patterns: string[] }[]>`
      insert into doc_senders (owner_id, name, patterns)
      values (${f.owner}, ${ex.senderName}, ${[ex.senderMatch ?? ex.senderName.toLowerCase()]})
      on conflict (owner_id, lower(name)) do update set name = doc_senders.name
      returning id, name, patterns`
    senderId = s.id
    if (!senders.some((x) => x.id === s.id)) known.set(f.owner, [...senders, s])
  }
  const guess = {
    type: ex.type,
    sender: ex.senderName,
    senderMatch: ex.senderMatch,
    date: ex.date,
    amount: ex.amount,
    currency: ex.currency,
    expiry: ex.expiry,
    confidence: ex.confidence,
  }
  await sql`
    insert into documents (node_id, owner_id, version_id, status, source, type_id, sender_id, doc_date, amount, currency, expires_at, guess)
    values (${f.id}, ${f.owner}, ${f.v}, 'review', 'auto', ${(ex.type && types.get(ex.type)) || null}, ${senderId},
      ${ex.date}, ${ex.amount}, ${ex.currency}, ${ex.expiry}, ${sql.json(guess)})
    on conflict (node_id) do update set
      version_id = excluded.version_id, type_id = excluded.type_id, sender_id = excluded.sender_id,
      doc_date = excluded.doc_date, amount = excluded.amount, currency = excluded.currency,
      expires_at = excluded.expires_at, updated_at = now(),
      guess = excluded.guess || case when documents.guess ? 'clip' then jsonb_build_object('clip', documents.guess->'clip') else '{}' end
    where documents.status = 'review'`
  await markDuplicate(f.id, f.sha)
  await markLater(f.id, f.sha)
  console.log(`doc   ${f.name} (${ex.type ?? "no type"}, ${ex.senderName ?? "no sender"}, ${ex.confidence})`)
}

// ---- CLIP type hint for pictures ----

const PROMPTS: Record<string, string> = {
  receipt: "a photo of a shop receipt",
  invoice: "a scan of an invoice",
  bill: "a scan of a utility bill",
  contract: "a scan of a signed contract",
  id: "a photo of an identity card or passport",
  warranty: "a warranty card",
  insurance: "an insurance policy document",
  tax: "a tax form",
  statement: "a bank statement",
  medical: "a medical report or prescription",
  certificate: "a certificate",
}
const textVecs = new Map<string, [string, number[]][]>()

const cosine = (a: number[], b: number[]) => {
  let d = 0, x = 0, y = 0
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i]
    x += a[i] * a[i]
    y += b[i] * b[i]
  }
  return d / Math.sqrt(x * y)
}

// Pictures in review with no type: ask what CLIP thinks of the picture the ML sweep already embedded.
// Skipped quietly when nimbus-ml isn't set up, or CLIP or the Documents hint is off.
async function clipHints(types: Map<string, string>) {
  const [s] = await sql<{ on: boolean; url: string; model: string }[]>`
    select ml_clip and docs_ml as on, ml_url as url, clip_model as model from settings`
  const base = mlBase(s.url)
  if (!s.on || !base) return
  const rows = await sql<{ id: string; vec: string }[]>`
    select d.node_id as id, e.vec::text as vec from documents d
    join nodes n on n.id = d.node_id and n.current_version_id = d.version_id
    join node_embeddings e on e.node_id = d.node_id and e.version_id = d.version_id and e.t_ms is null and e.model = ${s.model}
    where d.status = 'review' and d.type_id is null and not (d.guess ? 'clip') limit 20`
  if (!rows.length) return
  const api = ml(base)
  if (!textVecs.has(s.model))
    textVecs.set(s.model, await Promise.all(Object.entries(PROMPTS).map(async ([k, q]) => [k, await api.clipText(q, s.model)] as [string, number[]])))
  const min = CLIP_MIN_SIM[s.model] ?? 0.26
  for (const r of rows) {
    const vec = JSON.parse(r.vec) as number[]
    const [best, next] = textVecs.get(s.model)!.map(([k, t]) => ({ k, score: cosine(vec, t) })).sort((a, b) => b.score - a.score)
    const sure = best.score >= min && best.score - next.score >= 0.01
    await sql`update documents set guess = guess || ${sql.json({ clip: { type: best.k, score: Math.round(best.score * 1000) / 1000 } })},
        type_id = case when ${sure} then ${types.get(best.k) ?? null} else type_id end, updated_at = now()
      where node_id = ${r.id} and status = 'review' and type_id is null`
    console.log(`doc   clip ${r.id}: ${best.k} ${best.score.toFixed(3)}${sure ? "" : " (not sure)"}`)
  }
}

export async function docsSweep() {
  const [{ on }] = await sql<{ on: boolean }[]>`select documents_enabled as on from settings`
  docsStatus.enabled = on
  if (!on) return 0
  const rows = await sql<Row[]>`
    select n.id, n.owner_id as owner, n.current_version_id as v, n.name, n.created_at as created, fv.sha256 as sha, c.body
    ${candidates()} order by n.updated_at desc limit ${BATCH}`
  const types = await typeIds()
  const owners = [...new Set(rows.map((r) => r.owner))]
  const known = new Map<string, KnownSender[]>()
  if (owners.length)
    for (const s of await sql<(KnownSender & { owner: string })[]>`
      select id, name, patterns, owner_id as owner from doc_senders where owner_id in ${sql(owners)}`)
      known.set(s.owner, [...(known.get(s.owner) ?? []), s])
  let done = 0
  for (const f of rows) {
    try {
      await file(f, types, known)
      done++
    } catch (e) {
      docsStatus.lastError = `${f.name}: ${(e as Error).message}`
      console.error(`doc   ${docsStatus.lastError}`)
    }
  }
  await clipHints(types).catch((e: Error) => console.error(`doc   clip: ${e.message}`))
  const [c] = await sql<{ backlog: number; docs: number; review: number }[]>`
    select (select count(*)::int ${candidates()}) as backlog,
      (select count(*)::int from documents where status <> 'dismissed') as docs,
      (select count(*)::int from documents where status = 'review') as review`
  Object.assign(docsStatus, { backlog: c.backlog, documents: c.docs, review: c.review })
  return done
}

// Run directly, not imported by the worker.
if (process.argv[1]?.endsWith("scripts/documents.ts")) {
  console.log(`Filed ${await docsSweep()} documents.`)
  await sql.end()
  process.exit(0)
}
