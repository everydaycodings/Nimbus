import "server-only"

import {
  aliasedTable,
  and,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import {
  DENSITY_COOKIE,
  LAYOUT_COOKIE,
  TILES_COOKIE,
} from "@/components/nav-styles"
import { db } from "@/lib/db"
import {
  fileVersions,
  auditEvents,
  authEvents,
  linkEvents,
  nodeOpens,
  nodeTags,
  nodes,
  settings,
  shares,
  shortcuts,
  stars,
  tags,
  user,
  type TagColor,
} from "@/lib/db/schema"
import { accessOne, accessTo, atLeast, type Access } from "@/lib/access"
import { JUNK, UUID } from "@/lib/file-rules"
import { purgeSavedLogins } from "@/lib/saved-logins"
import { getSession } from "@/lib/session"
import { deleteNodes } from "@/lib/uploads"

// What the browser gets for each file or folder. Dates are ISO strings so they
// cross the server/client boundary.
export type Item = {
  id: string
  kind: "file" | "folder"
  name: string
  size: number
  mime: string | null
  starred: boolean
  updatedAt: string
  trashedAt: string | null
  // Ids of the viewer's own tags on it.
  tags: string[]
  owner?: string
  ownerImage?: string | null
  // Current version of a file; thumbnails and previews are per version.
  version: string | null
  // Its thumbnail's revision: null until the browser tries, "" when it couldn't
  // make one.
  thumb: string | null
  // The viewer's access when the item isn't theirs.
  role?: "editor" | "viewer"
  // Shared with members or invited emails, and whether it has a public link.
  sharedWithPeople: boolean
  hasLink: boolean
  // A shortcut in My files to something shared with the viewer.
  shortcut?: boolean
  // Its current version's text is in the search index (or had none to read).
  indexed?: boolean
}

export type Tag = { id: string; name: string; color: TagColor }

// File pages render alongside the layout, whose gates decide what is shown.
// They only need to know whose files to load.
export async function pageUserId() {
  const session = await getSession()
  if (!session) redirect("/sign-in")
  return session.user.id
}

export async function viewPrefs() {
  const c = await cookies()
  return {
    layout: c.get(LAYOUT_COOKIE)?.value === "list" ? "list" : "grid",
    compact: c.get(DENSITY_COOKIE)?.value === "compact",
    tiles:
      (["small", "large"] as const).find(
        (t) => t === c.get(TILES_COOKIE)?.value
      ) ?? "medium",
  } as const
}

export { UUID }

const cols = (viewer: string) => ({
  id: nodes.id,
  kind: nodes.kind,
  name: nodes.name,
  // A folder's size is everything inside it that shares its trash state.
  // ponytail: recursive sum per folder row; cache it on the node if big trees get slow.
  // Raw "nodes".x refs: Drizzle leaves ${column} unqualified here, which would
  // bind to the inner table. Coalesce, not `is not distinct from`: the planner
  // guesses that matches one row and goes quadratic (18s at 10k files vs 0.2s).
  size: sql<number>`case when "nodes".kind = 'file' then "nodes".size else (
    with recursive d as (
      select c.id, c.size from nodes c
      where c.parent_id = "nodes".id
        and coalesce(c.trashed_at, 'infinity') = coalesce("nodes".trashed_at, 'infinity')
      union all
      select n.id, n.size from nodes n join d on n.parent_id = d.id
      where coalesce(n.trashed_at, 'infinity') = coalesce("nodes".trashed_at, 'infinity')
    ) select coalesce(sum(size), 0) from d) end`.mapWith(Number),
  mime: nodes.mime,
  starred: sql<boolean>`exists (
    select 1 from stars where node_id = "nodes".id and user_id = ${viewer})`,
  updatedAt: nodes.updatedAt,
  trashedAt: nodes.trashedAt,
  tags: sql<string[]>`array(
    select nt.tag_id from node_tags nt join tags t on t.id = nt.tag_id
    where nt.node_id = "nodes".id and t.owner_id = ${viewer})`,
  version: nodes.currentVersionId,
  thumb: sql<string | null>`(
    select thumb from file_versions where id = "nodes".current_version_id)`,
  sharedWithPeople: sql<boolean>`exists (
    select 1 from shares where node_id = "nodes".id and token is null)`,
  hasLink: sql<boolean>`exists (
    select 1 from shares where node_id = "nodes".id and token is not null)`,
  indexed: sql<boolean>`exists (
    select 1 from node_content
    where node_id = "nodes".id and version_id = "nodes".current_version_id)`,
})

type Row = Omit<Item, "updatedAt" | "trashedAt"> & {
  updatedAt: Date
  trashedAt: Date | null
}

const toItem = (r: Row): Item => ({
  ...r,
  updatedAt: r.updatedAt.toISOString(),
  trashedAt: r.trashedAt?.toISOString() ?? null,
})

// Untrashed, outside any vault, owned by `ownerId`.
const live = (ownerId: string) =>
  and(
    eq(nodes.ownerId, ownerId),
    isNull(nodes.trashedAt),
    isNull(nodes.vaultId)
  )

// Apps' temporary save files stay off the web (they're for WebDAV clients).
const notJunk = sql`${nodes.name} !~* ${JUNK}`

const foldersFirst = [
  sql`${nodes.kind} = 'folder' desc`,
  sql`lower(${nodes.name})`,
]

// Someone else's items carry the viewer's role on them.
const withRole = (r: Row, role: Access): Item =>
  role === "owner" ? toItem(r) : { ...toItem(r), role }

// A folder's contents as `viewer` sees them; `ownerId` owns the whole folder.
// The viewer's own root also lists their shortcuts.
export async function listFolder(
  viewer: string,
  ownerId: string,
  parentId: string | null,
  role: Access = "owner"
) {
  const rows = await db
    .select(cols(viewer))
    .from(nodes)
    .where(
      and(
        live(ownerId),
        parentId ? eq(nodes.parentId, parentId) : isNull(nodes.parentId),
        notJunk
      )
    )
    .orderBy(...foldersFirst)
  const items = rows.map((r) => withRole(r, role))
  if (parentId || viewer !== ownerId) return items

  const linked = await db
    .select(cols(viewer))
    .from(shortcuts)
    .innerJoin(nodes, eq(nodes.id, shortcuts.nodeId))
    .where(and(eq(shortcuts.userId, viewer), isNull(nodes.trashedAt)))
  const access = await accessTo(
    viewer,
    linked.map((r) => r.id)
  )
  for (const r of linked) {
    const a = access.get(r.id)
    if (a) items.push({ ...withRole(r, a.role), shortcut: true })
  }
  return items
}

// A folder the viewer can open, with their role and its owner.
export async function getFolder(viewer: string, id: string) {
  if (!UUID.test(id)) return null
  const a = await accessOne(viewer, id)
  if (!a || a.kind !== "folder" || a.trashed) return null
  const [row] = await db
    .select({ id: nodes.id, name: nodes.name })
    .from(nodes)
    .where(eq(nodes.id, id))
  return row ? { ...row, role: a.role, ownerId: a.ownerId } : null
}

// The folder and everything above it, root first.
export async function getPath(id: string) {
  const rows = await db.execute<{ id: string; name: string }>(sql`
    with recursive up as (
      select id, name, parent_id, 0 as depth from nodes where id = ${id}
      union all
      select n.id, n.name, n.parent_id, up.depth + 1
      from nodes n join up on n.id = up.parent_id
    )
    select id, name from up order by depth desc`)
  return [...rows]
}

// Previews, downloads, uploads and renames count as opening something.
export async function markOpened(userId: string, nodeId: string) {
  await db
    .insert(nodeOpens)
    .values({ userId, nodeId })
    .onConflictDoUpdate({
      target: [nodeOpens.userId, nodeOpens.nodeId],
      set: { openedAt: sql`now()` },
    })
}

// What the viewer opened last, theirs or shared with them, newest first.
export async function listRecent(viewer: string) {
  const rows = await db
    .select(cols(viewer))
    .from(nodeOpens)
    .innerJoin(nodes, eq(nodes.id, nodeOpens.nodeId))
    .where(
      and(
        eq(nodeOpens.userId, viewer),
        isNull(nodes.trashedAt),
        isNull(nodes.vaultId),
        notJunk
      )
    )
    .orderBy(desc(nodeOpens.openedAt))
    .limit(50)
  return withAccess(viewer, rows)
}

// Rows the viewer can still see, with their role.
async function withAccess(viewer: string, rows: Row[]) {
  const access = await accessTo(
    viewer,
    rows.map((r) => r.id)
  )
  return rows.flatMap((r) => {
    const a = access.get(r.id)
    return a ? [withRole(r, a.role)] : []
  })
}

export type Hit = Item & {
  // The folder it's in, as the viewer knows it.
  where: string
  // Its name matched; otherwise only its text did.
  byName: boolean
  // Text around the match, with \u0001…\u0002 around the matched words.
  snippet: string | null
}

// Names (substring or close spelling) and file text, across the viewer's own
// files and everything shared with them. Trash and vaults stay out.
// ponytail: word_similarity scans every visible name; switch to the %> operator
// (which uses nodes_name_trgm_idx) if one account holds millions of items.
export async function searchItems(
  viewer: string,
  raw: string,
  limit = 50
): Promise<Hit[]> {
  const q = raw.trim().slice(0, 200)
  if (!q) return []
  const found = await db.execute<{
    id: string
    where: string | null
    by_name: boolean
    snippet: string | null
  }>(sql`
    with recursive shared as (
      select n.id from nodes n
      join shares s on s.node_id = n.id and s.grantee_id = ${viewer}
      where n.trashed_at is null and n.vault_id is null
      union
      select c.id from nodes c join shared on c.parent_id = shared.id
      where c.trashed_at is null
    ), q as (
      select websearch_to_tsquery('simple', ${q}) as tq, lower(replace(${q}, '"', '')) as s
    ), scored as (
      select n.id, n.owner_id, n.parent_id,
        case
          when strpos(lower(n.name), q.s) > 0 then 2 + similarity(q.s, lower(n.name))
          when word_similarity(q.s, lower(n.name)) >= 0.4 then word_similarity(q.s, lower(n.name))
        end as name_score,
        case when c.tsv @@ q.tq then 0.4 + ts_rank(c.tsv, q.tq) end as text_score
      from nodes n
      cross join q
      left join node_content c
        on c.node_id = n.id and c.version_id = n.current_version_id
      where n.trashed_at is null and n.vault_id is null and n.name !~* ${JUNK}
        and (n.owner_id = ${viewer} or n.id in (select id from shared))
    ), top as (
      select * from scored
      where name_score is not null or text_score is not null
      order by greatest(name_score, text_score) desc
      limit ${limit}
    )
    select top.id, top.name_score is not null as by_name,
      case
        when top.owner_id = ${viewer} then coalesce(p.name, 'My files')
        when exists (select 1 from shares
          where node_id = top.id and grantee_id = ${viewer}) then 'Shared with me'
        else p.name
      end as where,
      case when top.text_score is not null then ts_headline('simple', c.body, q.tq,
        'StartSel=' || chr(1) || ', StopSel=' || chr(2) || ', MaxFragments=1, MaxWords=18, MinWords=6')
      end as snippet
    from top
    cross join q
    left join nodes p on p.id = top.parent_id
    left join node_content c on c.node_id = top.id
    order by greatest(top.name_score, top.text_score) desc`)
  if (!found.length) return []
  const meta = new Map(found.map((f, i) => [f.id, { ...f, i }]))
  const rows = await db
    .select(cols(viewer))
    .from(nodes)
    .where(
      inArray(
        nodes.id,
        found.map((f) => f.id)
      )
    )
  return (await withAccess(viewer, rows))
    .sort((a, b) => meta.get(a.id)!.i - meta.get(b.id)!.i)
    .map((item) => {
      const m = meta.get(item.id)!
      return {
        ...item,
        where: m.where ?? "",
        byName: m.by_name,
        snippet: m.snippet,
      }
    })
}

// Starred items the viewer can still see, theirs or shared with them.
export async function listStarred(viewer: string) {
  const rows = await db
    .select(cols(viewer))
    .from(stars)
    .innerJoin(nodes, eq(nodes.id, stars.nodeId))
    .where(
      and(
        eq(stars.userId, viewer),
        isNull(nodes.trashedAt),
        isNull(nodes.vaultId)
      )
    )
    .orderBy(...foldersFirst)
  return withAccess(viewer, rows)
}

// Items carrying one of the viewer's tags that they can still see.
export async function listByTag(viewer: string, tagId: string) {
  const rows = await db
    .select(cols(viewer))
    .from(nodeTags)
    .innerJoin(nodes, eq(nodes.id, nodeTags.nodeId))
    .where(
      and(
        eq(nodeTags.tagId, tagId),
        isNull(nodes.trashedAt),
        isNull(nodes.vaultId)
      )
    )
    .orderBy(...foldersFirst)
  return withAccess(viewer, rows)
}

// Only what was trashed directly: a folder's contents went with it and come back with it.
export async function listTrash(ownerId: string) {
  const parent = aliasedTable(nodes, "parent")
  const rows = await db
    .select(cols(ownerId))
    .from(nodes)
    .leftJoin(parent, eq(parent.id, nodes.parentId))
    .where(
      and(
        eq(nodes.ownerId, ownerId),
        isNotNull(nodes.trashedAt),
        isNull(nodes.vaultId),
        sql`${parent.trashedAt} is distinct from ${nodes.trashedAt}`
      )
    )
    .orderBy(desc(nodes.trashedAt))
  return rows.map(toItem)
}

export async function listShared(userId: string) {
  const rows = await db
    .select({
      ...cols(userId),
      owner: user.name,
      ownerImage: user.image,
      shareRole: shares.role,
    })
    .from(shares)
    .innerJoin(nodes, eq(nodes.id, shares.nodeId))
    .innerJoin(user, eq(user.id, nodes.ownerId))
    .where(
      and(
        eq(shares.granteeId, userId),
        isNull(nodes.trashedAt),
        or(isNull(shares.expiresAt), gt(shares.expiresAt, sql`now()`))
      )
    )
    .orderBy(desc(shares.createdAt))
  return rows.map(({ shareRole, ...r }) => withRole(r, shareRole))
}

// The owner's items with a person share or a public link that still works.
export async function listSharedByMe(ownerId: string) {
  const rows = await db
    .select(cols(ownerId))
    .from(nodes)
    .where(
      and(
        live(ownerId),
        sql`exists (select 1 from shares where node_id = "nodes".id
          and (expires_at is null or expires_at > now()))`
      )
    )
    .orderBy(...foldersFirst)
  return rows.map(toItem)
}

export async function getTrashRetention() {
  const [row] = await db
    .select({ days: settings.trashRetentionDays })
    .from(settings)
  return row?.days ?? null
}

// Deletes trash older than the admin's retention for everyone, and link and
// account events older than 90 days, admin audit events older than a year, and expired saved logins. The worker runs it hourly (/api/jobs).
export async function purgeExpiredTrash() {
  await db
    .delete(linkEvents)
    .where(sql`${linkEvents.at} < now() - interval '90 days'`)
  await db
    .delete(authEvents)
    .where(sql`${authEvents.at} < now() - interval '90 days'`)
  await db
    .delete(auditEvents)
    .where(sql`${auditEvents.at} < now() - interval '1 year'`)
  await purgeSavedLogins()
  const days = await getTrashRetention()
  if (!days) return
  await deleteNodes(
    sql`${nodes.trashedAt} < now() - make_interval(days => ${days}::int)`
  )
}

export async function listTags(ownerId: string): Promise<Tag[]> {
  return db
    .select({ id: tags.id, name: tags.name, color: tags.color })
    .from(tags)
    .where(eq(tags.ownerId, ownerId))
    .orderBy(sql`lower(${tags.name})`)
}

// A file the user can open: theirs or shared with them, at its current version
// or, for its owner and editors, an older one. Only the owner opens trashed files.
export async function openableFile(
  userId: string,
  id: string,
  v?: string | null
) {
  if (!UUID.test(id) || (v && !UUID.test(v))) return null
  const a = await accessOne(userId, id)
  if (!a || a.kind !== "file" || (a.trashed && a.role !== "owner")) return null
  const [row] = await db
    .select({
      name: nodes.name,
      ownerId: nodes.ownerId,
      versionId: nodes.currentVersionId,
      key: nodes.s3Key,
      mime: nodes.mime,
    })
    .from(nodes)
    .where(eq(nodes.id, id))
  if (!row?.key) return null
  const mine = a.role === "owner"
  if (!v || v === row.versionId)
    return { ...row, key: row.key, mine, role: a.role }
  if (!atLeast(a.role, "editor")) return null
  const [ver] = await db
    .select({ key: fileVersions.s3Key, mime: fileVersions.mime })
    .from(fileVersions)
    .where(and(eq(fileVersions.id, v), eq(fileVersions.nodeId, id)))
  return ver ? { ...row, ...ver, versionId: v, mine, role: a.role } : null
}

// One item as `viewer` would see it in a list. Callers check access.
export async function getItem(viewer: string, id: string) {
  if (!UUID.test(id)) return null
  const [row] = await db
    .select(cols(viewer))
    .from(nodes)
    .where(eq(nodes.id, id))
  return row ? toItem(row) : null
}
