import "server-only"

import {
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

import { db } from "@/lib/db"
import { folderOwner } from "@/lib/access"
import {
  fileVersions,
  linkEvents,
  nodes,
  settings,
  shares,
  user,
  vaults,
} from "@/lib/db/schema"
import { notify, notifyEdit } from "@/lib/notify"
import { UUID, zipName } from "@/lib/file-rules"
import { deleteKeys, getText, headSize } from "@/lib/s3"
import {
  extOf,
  freeName,
  readUploadToken,
  sizeLabel,
  splitPath,
  type UploadToken,
} from "@/lib/upload-rules"

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Db = typeof db | Tx

// Postgres unique_violation, raw or wrapped by Drizzle.
export function isClash(e: unknown) {
  const err = e as { code?: string; cause?: { code?: string } }
  return (err.cause?.code ?? err.code) === "23505"
}

export async function uploadLimits() {
  const [row] = await db
    .select({
      maxUploadBytes: settings.maxUploadBytes,
      blockedExtensions: settings.blockedExtensions,
    })
    .from(settings)
  return row ?? { maxUploadBytes: null, blockedExtensions: [] }
}

export function rejectReason(
  name: string,
  size: number,
  limits: Awaited<ReturnType<typeof uploadLimits>>
) {
  if (limits.maxUploadBytes !== null && size > limits.maxUploadBytes)
    return `Larger than the ${sizeLabel(limits.maxUploadBytes)} upload limit.`
  const ext = extOf(name)
  if (ext && limits.blockedExtensions.includes(ext))
    return `.${ext} files can't be uploaded.`
  return null
}

export async function isActiveUser(id: string) {
  const [row] = await db
    .select({ status: user.status })
    .from(user)
    .where(eq(user.id, id))
  return row?.status === "active"
}

// A folder the user can put things in: theirs, untrashed, and in `vaultId`
// (or outside any vault without one). Null is the root of either.
export async function isOpenFolder(
  ownerId: string,
  id: string | null,
  vaultId?: string
) {
  if (vaultId) {
    const [v] = await db
      .select({ id: vaults.id })
      .from(vaults)
      .where(and(eq(vaults.id, vaultId), eq(vaults.ownerId, ownerId)))
    if (!v) return false
  }
  if (id === null) return true
  const [row] = await db
    .select({ id: nodes.id })
    .from(nodes)
    .where(
      and(
        eq(nodes.id, id),
        eq(nodes.ownerId, ownerId),
        eq(nodes.kind, "folder"),
        isNull(nodes.trashedAt),
        vaultId ? eq(nodes.vaultId, vaultId) : isNull(nodes.vaultId)
      )
    )
  return Boolean(row)
}

// A vault upload's name is sealed by the browser (base64 of iv + ciphertext).
export const isSealedName = (s: unknown): s is string =>
  typeof s === "string" && s.length <= 4096 && /^[A-Za-z0-9+/]+=*$/.test(s)

const inFolder = (ownerId: string, parentId: string | null) =>
  and(
    eq(nodes.ownerId, ownerId),
    parentId ? eq(nodes.parentId, parentId) : isNull(nodes.parentId),
    isNull(nodes.trashedAt)
  )

async function child(
  tx: Db,
  ownerId: string,
  parentId: string | null,
  name: string
) {
  const [row] = await tx
    .select({ id: nodes.id, kind: nodes.kind })
    .from(nodes)
    .where(
      and(
        inFolder(ownerId, parentId),
        sql`lower(${nodes.name}) = lower(${name})`
      )
    )
  return row
}

// mkdir -p under parentId. Race-safe: the unique name index turns a concurrent
// create into a no-op, and the select then finds whichever row won.
// `cache` maps "/a/b" (lowercased) to ids for repeated calls with the same parent.
export async function mkdirp(
  tx: Db,
  ownerId: string,
  parentId: string | null,
  names: string[],
  cache = new Map<string, string>()
): Promise<{ id: string | null } | { error: string }> {
  let id = parentId
  let path = ""
  for (const name of names) {
    path += "/" + name.toLowerCase()
    const hit = cache.get(path)
    if (hit) {
      id = hit
      continue
    }
    await tx
      .insert(nodes)
      .values({ ownerId, parentId: id, kind: "folder", name })
      .onConflictDoNothing()
    const row = await child(tx, ownerId, id, name)
    if (row?.kind !== "folder")
      return { error: `A file named “${name}” is in the way of a folder.` }
    id = row.id
    cache.set(path, id)
  }
  return { id }
}

// Drops versions past the admin's keep-last / max-age caps, never the newest,
// and deletes objects nothing points at any more.
// Appends a version numbered after the file's last one. Locks the file row so
// two uploads of the same name can't take the same number.
export async function addVersion(
  tx: Db,
  nodeId: string,
  v: Omit<typeof fileVersions.$inferInsert, "nodeId" | "number">
) {
  await tx.execute(sql`select 1 from nodes where id = ${nodeId} for update`)
  const [row] = await tx
    .insert(fileVersions)
    .values({
      ...v,
      nodeId,
      number: sql`(select coalesce(max(number), 0) + 1 from file_versions where node_id = ${nodeId})`,
    })
    .returning({ id: fileVersions.id, number: fileVersions.number })
  return row
}

export async function pruneVersions(nodeId: string) {
  const [s] = await db
    .select({
      keep: settings.versionKeepLast,
      days: settings.versionMaxAgeDays,
    })
    .from(settings)
  if (!s || (s.keep === null && s.days === null)) return
  // Never the current version or one marked to keep.
  const gone = await db.execute<{ s3_key: string }>(sql`
    with ranked as (
      select v.id, v.created_at, v.keep, v.id = n.current_version_id as current,
        row_number() over (order by v.number desc) as n
      from file_versions v join nodes n on n.id = v.node_id
      where v.node_id = ${nodeId}
    )
    delete from file_versions v using ranked r
    where v.id = r.id and not r.current and not r.keep and (
      (${s.keep}::int is not null and r.n > ${s.keep}::int) or
      (${s.days}::int is not null and r.created_at < now() - make_interval(days => ${s.days}::int))
    )
    returning v.s3_key`)
  await deleteUnreferenced(gone.map((r) => r.s3_key))
}

// Restore makes two versions share a key, so only delete keys no row still uses.
export async function deleteUnreferenced(keys: string[]) {
  if (!keys.length) return
  const used = await db
    .select({ key: fileVersions.s3Key })
    .from(fileVersions)
    .where(inArray(fileVersions.s3Key, keys))
  const keep = new Set(used.map((r) => r.key))
  await deleteKeys(keys.filter((k) => !keep.has(k)))
}

// Deletes the nodes matching `where` and everything inside them, rows first,
// then their S3 objects.
export async function deleteNodes(where: SQL | undefined) {
  if (!where) return
  const keys = await db.execute<{ s3_key: string }>(sql`
    with recursive t as (
      select id from nodes where ${where}
      union
      select n.id from nodes n join t on n.parent_id = t.id
    )
    select distinct s3_key from file_versions where node_id in (select id from t)`)
  await db.delete(nodes).where(where)
  await deleteUnreferenced(keys.map((r) => r.s3_key))
}

type Finished = {
  error?: string
  nodeId?: string
  versionId?: string
  vault?: boolean
}

// A public link that still takes uploads, with what notifications need.
export async function dropLink(shareId: string) {
  const [row] = await db
    .select({
      id: shares.id,
      nodeId: shares.nodeId,
      name: shares.name,
      cap: shares.uploadCapBytes,
      createdBy: shares.createdBy,
    })
    .from(shares)
    .innerJoin(settings, sql`true`)
    .innerJoin(nodes, eq(nodes.id, shares.nodeId))
    .where(
      and(
        eq(shares.id, shareId),
        isNotNull(shares.token),
        eq(shares.allowUpload, true),
        eq(settings.publicLinksEnabled, true),
        isNull(nodes.trashedAt),
        or(isNull(shares.expiresAt), gt(shares.expiresAt, sql`now()`))
      )
    )
  return row ?? null
}

// Bytes a file-drop link has taken in so far.
export async function droppedBytes(shareId: string) {
  const [row] = await db
    .select({ n: sql<string>`coalesce(sum(${fileVersions.size}), 0)::text` })
    .from(fileVersions)
    .where(eq(fileVersions.viaShareId, shareId))
  return Number(row?.n ?? 0)
}

// Whoever the token names may still add to its folder: the owner, an editor
// who still is one, or a link that still takes uploads into that folder or
// one inside it.
export async function uploaderMayAdd(t: UploadToken) {
  if (!(await isActiveUser(t.u)) || !(await isOpenFolder(t.u, t.p, t.v)))
    return false
  if (t.v) return !t.b && !t.s
  if (t.b) return (await folderOwner(t.b, t.p)) === t.u
  if (t.s) {
    const link = await dropLink(t.s)
    return Boolean(link && t.p && (await isInside(t.p, link.nodeId)))
  }
  return true
}

// `id` is `root` or somewhere inside it.
export async function isInside(id: string, root: string) {
  const [row] = await db.execute<{ ok: boolean }>(sql`
    with recursive up as (
      select id, parent_id from nodes where id = ${id}
      union all
      select n.id, n.parent_id from nodes n join up on n.id = up.parent_id
    )
    select exists (select 1 from up where id = ${root}) as ok`)
  return Boolean(row?.ok)
}

// Turns a finished tus upload into a node, or a version of an existing one.
// Idempotent through file_versions.upload_id: the client and tusd's post-finish
// hook both call it, and the second call gets the first one's node.
export async function finishTusUpload(
  uploadId: string,
  by?: { user?: string; share?: string }
): Promise<Finished> {
  const key = uploadId.split("+")[0]
  if (!/^[\w.-]+$/.test(key)) return { error: "That isn't an upload." }

  const done = async () => {
    const [row] = await db
      .select({ nodeId: fileVersions.nodeId, versionId: fileVersions.id })
      .from(fileVersions)
      .where(eq(fileVersions.uploadId, uploadId))
    return row
  }
  const prior = await done()
  if (prior) return prior

  // tusd writes the object only once every part has arrived.
  const size = await headSize(key)
  if (size === null) return { error: "That upload hasn't finished yet." }
  let meta: Record<string, string>
  try {
    meta = JSON.parse(await getText(`${key}.info`)).MetaData ?? {}
  } catch {
    return { error: "That upload has no details." }
  }
  const token = readUploadToken(meta.token)
  if (
    !token ||
    (by?.user && (token.b ?? token.u) !== by.user) ||
    (by?.share && token.s !== by.share)
  )
    return { error: "That upload isn't yours." }
  if (token.v) return finishVaultUpload(token, meta, key, size, uploadId, done)
  const names = splitPath(meta.path)
  if (!names) return { error: "That upload has an invalid name." }
  if (!(await uploaderMayAdd(token)))
    return { error: "The folder for that upload is gone." }

  const name = names.pop()!
  const mime = meta.filetype || null
  const version = {
    s3Key: key,
    size,
    mime,
    uploadId,
    uploadedBy: token.s ? null : (token.b ?? token.u),
    viaShareId: token.s ?? null,
    uploaderLabel: token.l?.slice(0, 80) || null,
  }

  let result: Finished
  try {
    result = await db.transaction(async (tx) => {
      const dir = await mkdirp(tx, token.u, token.p, names)
      if ("error" in dir) return dir
      const insert = (n: string) =>
        tx
          .insert(nodes)
          .values({
            ownerId: token.u,
            parentId: dir.id,
            kind: "file",
            name: n,
            size,
            mime,
            s3Key: key,
          })
          .onConflictDoNothing()
          .returning({ id: nodes.id })

      let [node] = await insert(name)
      if (!node) {
        const clash = await child(tx, token.u, dir.id, name)
        if (meta.onConflict === "version" && clash?.kind === "file") {
          await tx
            .update(nodes)
            .set({ s3Key: key, size, mime, updatedAt: new Date() })
            .where(eq(nodes.id, clash.id))
          node = clash
        } else {
          // Keep both. Retry in case another upload takes the free name first.
          for (let i = 0; !node && i < 5; i++) {
            const taken = await tx
              .select({ name: sql<string>`lower(${nodes.name})` })
              .from(nodes)
              .where(inFolder(token.u, dir.id))
            ;[node] = await insert(
              freeName(name, new Set(taken.map((t) => t.name)))
            )
          }
          if (!node)
            return { error: `Couldn't find a free name for “${name}”.` }
        }
      }
      const v = await addVersion(tx, node.id, version)
      await tx
        .update(nodes)
        .set({ currentVersionId: v.id })
        .where(eq(nodes.id, node.id))
      return { nodeId: node.id, versionId: v.id }
    })
  } catch (e) {
    // The other caller finished the same upload first.
    if (isClash(e)) {
      const row = await done()
      if (row) return row
    }
    throw e
  }
  if (result.nodeId) {
    await pruneVersions(result.nodeId)
    if (token.b) await notifyEdit(token.b, result.nodeId)
    if (token.s) {
      const link = await dropLink(token.s)
      if (link) {
        await db.insert(linkEvents).values({
          shareId: link.id,
          kind: "upload",
          ip: token.i ?? null,
          detail: [...names, name].join("/"),
        })
        await notify(token.u, "file_drop", {
          nodeId: link.nodeId,
          data: { uploader: token.l ?? "", link: link.name ?? "" },
        })
      }
    }
  }
  return result
}

// Vault files: the name, its tag and the file key arrive sealed, folders were
// made before the upload (so no plaintext path is sent), and there are no
// versions: "Replace" names the file this one takes the place of.
async function finishVaultUpload(
  token: UploadToken,
  meta: Record<string, string>,
  key: string,
  size: number,
  uploadId: string,
  done: () => Promise<{ nodeId: string; versionId: string } | undefined>
): Promise<Finished> {
  if (![meta.filename, meta.encKey, meta.nameTag].every(isSealedName))
    return { error: "That upload has an invalid name." }
  if (!(await uploaderMayAdd(token)))
    return { error: "The folder for that upload is gone." }
  const replaces = UUID.test(meta.replaces ?? "") ? meta.replaces : null
  let oldKeys: string[] = []
  try {
    const row = await db.transaction(async (tx) => {
      if (replaces) {
        const old = await tx
          .select({ key: fileVersions.s3Key })
          .from(fileVersions)
          .innerJoin(nodes, eq(nodes.id, fileVersions.nodeId))
          .where(
            and(
              eq(nodes.id, replaces),
              eq(nodes.vaultId, token.v!),
              eq(nodes.kind, "file")
            )
          )
        oldKeys = old.map((r) => r.key)
        if (old.length) await tx.delete(nodes).where(eq(nodes.id, replaces))
      }
      const [node] = await tx
        .insert(nodes)
        .values({
          ownerId: token.u,
          parentId: token.p,
          vaultId: token.v,
          kind: "file",
          name: meta.filename,
          nameTag: meta.nameTag,
          size,
          s3Key: key,
        })
        .returning({ id: nodes.id })
      const v = await addVersion(tx, node.id, {
        s3Key: key,
        size,
        uploadId,
        uploadedBy: token.u,
        encKey: meta.encKey,
      })
      await tx
        .update(nodes)
        .set({ currentVersionId: v.id })
        .where(eq(nodes.id, node.id))
      return { nodeId: node.id, versionId: v.id, vault: true }
    })
    await deleteUnreferenced(oldKeys)
    return row
  } catch (e) {
    if (!isClash(e)) throw e
    // Finished already (tusd's hook and the browser both finish), or the name
    // was taken while this uploaded.
    const row = await done()
    if (row) return { ...row, vault: true }
    await deleteKeys([key])
    return { error: "Something with that name is already in this folder." }
  }
}

// Everything under `ids` (untrashed) as relative paths, for zips. Callers
// check access to `ids` first. Same-named items from different folders get
// "name (1)".
export async function zipTree(ids: string[]) {
  if (!ids.length) return null
  const rows = await db.execute<{
    id: string
    root: string
    kind: "file" | "folder"
    path: string
    s3_key: string | null
    size: string
    updated_at: string
    empty: boolean
  }>(sql`
    with recursive t as (
      select id, id as root, kind, name::text as path, s3_key, size, updated_at
      from nodes
      where id in ${ids} and trashed_at is null and vault_id is null
      union all
      select n.id, t.root, n.kind, t.path || '/' || n.name, n.s3_key, n.size, n.updated_at
      from nodes n join t on n.parent_id = t.id
      where n.trashed_at is null
    )
    select t.*, not exists (
      select 1 from nodes c where c.parent_id = t.id and c.trashed_at is null
    ) as empty
    from t order by path`)
  if (!rows.length) return null

  // Rename clashing top-level items.
  const tops = rows.filter((r) => r.id === r.root)
  const taken = new Set<string>()
  const prefix = new Map<string, { cut: number; name: string }>()
  for (const r of tops) {
    const name = taken.has(r.path.toLowerCase())
      ? freeName(r.path, taken, r.kind === "folder")
      : r.path
    taken.add(name.toLowerCase())
    prefix.set(r.root, { cut: r.path.length, name })
  }
  const pathOf = (r: (typeof rows)[number]) => {
    const p = prefix.get(r.root)!
    return p.name + r.path.slice(p.cut)
  }

  return {
    name:
      tops.length === 1 && tops[0].kind === "folder"
        ? zipName(tops[0].path)
        : zipName(),
    files: rows
      .filter((r) => r.kind === "file")
      .map((r) => ({
        path: pathOf(r),
        key: r.s3_key!,
        size: Number(r.size),
        modified: new Date(r.updated_at),
      })),
    dirs: rows.filter((r) => r.kind === "folder" && r.empty).map(pathOf),
  }
}

// Versions newest first; the first is current.
export async function versionsOf(nodeId: string) {
  return db
    .select({
      id: fileVersions.id,
      number: fileVersions.number,
      s3Key: fileVersions.s3Key,
      size: fileVersions.size,
      mime: fileVersions.mime,
      note: fileVersions.note,
      keep: fileVersions.keep,
      createdAt: fileVersions.createdAt,
      uploadedBy: user.name,
      current: sql<boolean>`${fileVersions.id} = ${nodes.currentVersionId}`,
    })
    .from(fileVersions)
    .innerJoin(nodes, eq(nodes.id, fileVersions.nodeId))
    .leftJoin(user, eq(user.id, fileVersions.uploadedBy))
    .where(eq(fileVersions.nodeId, nodeId))
    .orderBy(desc(fileVersions.number))
}
