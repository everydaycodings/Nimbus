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
  type SQL,
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
import {
  JUNK,
  MEDIA_MIME_RE,
  MEDIA_NAME_RE,
  NOT_MEDIA_NAME_RE,
  UUID,
} from "@/lib/file-rules"
import { parsePhotoCursor, photoCursor } from "@nimbus/shared/photos"
import { decodeMentions, mentionIds } from "@nimbus/shared/comments"
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
  // Open comment threads.
  comments?: number
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
  comments: sql<number>`(select count(*)::int from comments
    where node_id = "nodes".id and parent_id is null and resolved_at is null)`,
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

// A photo or video of the viewer's plus, for the merged timeline, a partner's (see
// lib/services/partners). Others' photos carry `owner` (their name) and `role: "viewer"`.
export type PhotoRow = Item & { takenAt: string; fromPartner?: boolean; folderId: string | null }

export const photoWhen = sql`date_trunc('milliseconds', coalesce(${fileVersions.takenAt}, ${fileVersions.createdAt}))`
const isMedia = sql`(${nodes.name} ~* ${MEDIA_NAME_RE} or (${nodes.mime} ~ ${MEDIA_MIME_RE} and ${nodes.name} !~* ${NOT_MEDIA_NAME_RE}))`

// The viewer's own live media, and `extra` to narrow it (smart group, a day, ...).
export const ownMedia = (viewer: string) =>
  and(live(viewer), eq(nodes.kind, "file"), notJunk, isMedia)

// Media of partners who share with the viewer and haven't been hidden, from their `since` on.
const partnerMedia = (viewer: string) =>
  and(
    isNull(nodes.trashedAt),
    isNull(nodes.vaultId),
    eq(nodes.kind, "file"),
    notJunk,
    isMedia,
    sql`exists (select 1 from partners p where p.owner_id = "nodes".owner_id
      and p.partner_id = ${viewer} and p.status = 'active' and not p.hidden
      and (p.since is null or ${photoWhen} >= p.since))`
  )

// Photos matching `cond`, newest taken first, paged by (time, id) so uploads between pages
// don't shift the list. The caller has already decided the viewer may see what `cond` matches;
// the sharing facts of items that aren't the viewer's are dropped.
// ponytail: the match is by name or mime only (a .pdf labelled image/* counts); no index beyond owner/parent.
export async function photoItems(
  viewer: string,
  cond: SQL | undefined,
  limit: number,
  cursor?: string
) {
  const c = parsePhotoCursor(cursor)
  const rows = await db
    .select({
      ...cols(viewer),
      takenAt: sql<string>`to_char(${photoWhen} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
      ownerId: nodes.ownerId,
      folderId: nodes.parentId,
      ownerName: sql<string>`(select coalesce(nullif(name, ''), email) from "user" where id = "nodes".owner_id)`,
    })
    .from(nodes)
    .innerJoin(fileVersions, eq(fileVersions.id, nodes.currentVersionId))
    .where(
      and(
        cond,
        c
          ? sql`(${photoWhen}, ${nodes.id}) < (${new Date(c.ms).toISOString()}::timestamptz, ${c.id}::uuid)`
          : undefined
      )
    )
    .orderBy(desc(photoWhen), desc(nodes.id))
    .limit(limit + 1)
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)`.mapWith(Number) })
    .from(nodes)
    .innerJoin(fileVersions, eq(fileVersions.id, nodes.currentVersionId))
    .where(cond)
  const page = rows.slice(0, limit).map(({ ownerId, ownerName, ...r }): PhotoRow => {
    const item = { ...toItem(r), takenAt: r.takenAt, folderId: r.folderId }
    return ownerId === viewer
      ? item
      : {
          ...item,
          owner: ownerName,
          role: "viewer",
          sharedWithPeople: false,
          hasLink: false,
        }
  })
  const last = page[page.length - 1]
  return {
    items: page,
    total,
    nextCursor:
      rows.length > limit && last ? photoCursor(last.takenAt, last.id) : null,
  }
}

// The viewer's own photos and videos (the Photos timeline), plus their partners' (marked
// `fromPartner`) unless left out.
export async function listPhotos(
  viewer: string,
  limit: number,
  cursor?: string,
  partners = true
) {
  const r = await photoItems(
    viewer,
    partners ? or(ownMedia(viewer), partnerMedia(viewer)) : ownMedia(viewer),
    limit,
    cursor
  )
  return {
    ...r,
    items: r.items.map((i) => (i.owner ? { ...i, fromPartner: true } : i)),
  }
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
  // The snippet is from a comment, not the file's text.
  inComment?: boolean
}

// Everything the viewer can see, newest first, for search's filters with no text.
// The list route filters and pages it in memory, like its other lists.
export async function browseItems(viewer: string): Promise<Hit[]> {
  const found = await db.execute<{ id: string; where: string | null }>(sql`
    with recursive shared as (
      select n.id from nodes n
      join shares s on s.node_id = n.id and s.grantee_id = ${viewer}
      where n.trashed_at is null and n.vault_id is null
      union
      select c.id from nodes c join shared on c.parent_id = shared.id
      where c.trashed_at is null
    )
    select n.id,
      case
        when n.owner_id = ${viewer} then coalesce(p.name, 'My files')
        when exists (select 1 from shares
          where node_id = n.id and grantee_id = ${viewer}) then 'Shared with me'
        else p.name
      end as where
    from nodes n
    left join nodes p on p.id = n.parent_id
    where n.trashed_at is null and n.vault_id is null and n.name !~* ${JUNK}
      and (n.owner_id = ${viewer} or n.id in (select id from shared))
    order by n.updated_at desc`)
  if (!found.length) return []
  const order = new Map(found.map((f, i) => [f.id, { where: f.where, i }]))
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
    .sort((a, b) => order.get(a.id)!.i - order.get(b.id)!.i)
    .map((item) => ({
      ...item,
      where: order.get(item.id)!.where ?? "",
      byName: true,
      snippet: null,
    }))
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
  // "has:comments" keeps files with comments; alone, it lists them all.
  const hasComments = /(^|\s)has:comments(?=\s|$)/i.test(raw)
  const q = raw.replace(/(^|\s)has:comments(?=\s|$)/gi, " ").trim().slice(0, 200)
  if (!q && !hasComments) return []
  const found = await db.execute<{
    id: string
    where: string | null
    by_name: boolean
    snippet: string | null
    in_comment: boolean
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
        case when c.tsv @@ q.tq then 0.4 + ts_rank(c.tsv, q.tq) end as text_score,
        0.3 + cm.score as comment_score, cm.body as comment_body
      from nodes n
      cross join q
      left join node_content c
        on c.node_id = n.id and c.version_id = n.current_version_id
      left join lateral (
        select ts_rank(to_tsvector('simple', coalesce(k.body, '')), q.tq) as score, k.body
        from comments k
        where k.node_id = n.id and k.deleted_at is null
          and to_tsvector('simple', coalesce(k.body, '')) @@ q.tq
        order by 1 desc limit 1
      ) cm on true
      where n.trashed_at is null and n.vault_id is null and n.name !~* ${JUNK}
        and (n.owner_id = ${viewer} or n.id in (select id from shared))
        and (not ${hasComments} or exists (
          select 1 from comments k where k.node_id = n.id and k.deleted_at is null))
    ), top as (
      select * from scored
      where name_score is not null or text_score is not null or comment_score is not null
      order by greatest(name_score, text_score, comment_score) desc
      limit ${limit}
    )
    select top.id, top.name_score is not null as by_name,
      case
        when top.owner_id = ${viewer} then coalesce(p.name, 'My files')
        when exists (select 1 from shares
          where node_id = top.id and grantee_id = ${viewer}) then 'Shared with me'
        else p.name
      end as where,
      top.text_score is null and top.comment_score is not null as in_comment,
      case
        when top.text_score is not null then ts_headline('simple', c.body, q.tq,
          'StartSel=' || chr(1) || ', StopSel=' || chr(2) || ', MaxFragments=1, MaxWords=18, MinWords=6')
        when top.comment_score is not null then ts_headline('simple', top.comment_body, q.tq,
          'StartSel=' || chr(1) || ', StopSel=' || chr(2) || ', MaxFragments=1, MaxWords=18, MinWords=6')
      end as snippet
    from top
    cross join q
    left join nodes p on p.id = top.parent_id
    left join node_content c on c.node_id = top.id
    order by greatest(top.name_score, top.text_score, top.comment_score) desc`)
  if (!found.length) return []
  // Mentions in a comment snippet read as names.
  const ids = [
    ...new Set(found.flatMap((f) => (f.in_comment && f.snippet ? mentionIds(f.snippet) : []))),
  ]
  const names = new Map(
    ids.length
      ? (
          await db
            .select({ id: user.id, name: sql<string>`coalesce(nullif(${user.name}, ''), ${user.email})` })
            .from(user)
            .where(inArray(user.id, ids))
        ).map((u) => [u.id, u.name])
      : []
  )
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
        snippet:
          m.in_comment && m.snippet
            ? decodeMentions(m.snippet, (id) => names.get(id))
            : m.snippet,
        inComment: m.in_comment,
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
