"use server"

import { and, count, eq, inArray, isNull, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { db } from "@/lib/db"
import { fileVersions, nodes, vaults } from "@/lib/db/schema"
import { UUID } from "@/lib/files"
import { formatBytes } from "@/lib/file-rules"
import { spaceLeft } from "@/lib/quota"
import { presignGet } from "@/lib/s3"
import { requireMember } from "@/lib/session"
import { sizeLabel, signUploadToken } from "@/lib/upload-rules"
import {
  deleteNodes,
  isClash,
  isOpenFolder,
  isSealedName,
  uploadLimits,
} from "@/lib/uploads"
import { destroyVault, getVault, listVaults, vaultPolicy } from "@/lib/vault"
import { restoreNode, trashNodes } from "@/lib/tree"
import { cipherSize } from "@/lib/vault-crypto"

type Result = { error?: string }

const GONE = "That vault or folder is gone. Refresh and try again."
const TAKEN = "Something with that name is already in this folder."

const cleanIds = (ids: string[]) =>
  Array.isArray(ids) ? ids.filter((id) => UUID.test(id)).slice(0, 1000) : []

const inVault = (vaultId: string, ids: string[]) =>
  and(eq(nodes.vaultId, vaultId), inArray(nodes.id, ids))

async function myVault(vaultId: string) {
  const me = await requireMember()
  return { me, vault: await getVault(me.id, vaultId) }
}

export async function createVault(input: {
  name: string
  salt: string
  wrapped: string
  recoveryWrapped: string
  kdf: { t: number; m: number }
}): Promise<Result & { id?: string }> {
  const me = await requireMember()
  const name = String(input.name ?? "").trim()
  if (!name || name.length > 100) return { error: "Give the vault a name." }
  if (
    ![input.salt, input.wrapped, input.recoveryWrapped].every(isSealedName) ||
    !kdfOk(input.kdf)
  )
    return { error: "That vault's keys don't look right." }
  const policy = await vaultPolicy()
  if (!policy.enabled) return { error: "Vaults are turned off on this server." }
  if (policy.cap !== null) {
    const [{ n }] = await db
      .select({ n: count() })
      .from(vaults)
      .where(eq(vaults.ownerId, me.id))
    if (n >= policy.cap)
      return { error: `You can have at most ${policy.cap} vaults.` }
  }
  const [row] = await db
    .insert(vaults)
    .values({
      ownerId: me.id,
      name,
      salt: input.salt,
      wrappedKey: input.wrapped,
      recoveryWrappedKey: input.recoveryWrapped,
      kdfIterations: input.kdf.t,
      kdfMemory: input.kdf.m,
    })
    .returning({ id: vaults.id })
  return { id: row.id }
}

const kdfOk = (kdf: { t: number; m: number } | null) => {
  const { t, m } = kdf ?? { t: 0, m: 0 }
  return (
    Number.isInteger(t) &&
    Number.isInteger(m) &&
    t >= 1 &&
    t <= 10 &&
    m >= 19 * 1024 &&
    m <= 1024 * 1024
  )
}

// A new passphrase: the same vault key, wrapped again under a new salt.
export async function updateVaultKey(
  vaultId: string,
  input: { salt: string; wrapped: string; kdf: { t: number; m: number } }
): Promise<Result> {
  const { vault } = await myVault(vaultId)
  if (!vault) return { error: GONE }
  if (![input.salt, input.wrapped].every(isSealedName) || !kdfOk(input.kdf))
    return { error: "That passphrase's key doesn't look right." }
  await db
    .update(vaults)
    .set({
      salt: input.salt,
      wrappedKey: input.wrapped,
      kdfIterations: input.kdf.t,
      kdfMemory: input.kdf.m,
    })
    .where(eq(vaults.id, vault.id))
  return {}
}

// The browser checked the passphrase and the typed name first; the server
// can't, since it never sees the passphrase.
export async function deleteVault(vaultId: string): Promise<Result> {
  const { vault } = await myVault(vaultId)
  if (!vault) return { error: GONE }
  await destroyVault(vault.id)
  revalidatePath("/", "layout")
  return {}
}

// For "Move to vault…" in My files.
export async function myVaults() {
  const me = await requireMember()
  return (await listVaults(me.id)).map((v) => ({ id: v.id, name: v.name }))
}

export type VaultNode = {
  id: string
  parentId: string | null
  kind: "file" | "folder"
  name: string // sealed
  size: number
  updatedAt: string
  trashedAt: string | null
  encKey: string | null
  // Has its name tag; older items get one the next time the vault opens.
  tagged: boolean
}

// The whole vault in one go; the browser decrypts names and builds the tree.
// ponytail: one query per unlock, page it if vaults grow past ~50k items.
export async function vaultTree(vaultId: string): Promise<VaultNode[] | null> {
  const { vault } = await myVault(vaultId)
  if (!vault) return null
  const rows = await db
    .select({
      id: nodes.id,
      parentId: nodes.parentId,
      kind: nodes.kind,
      name: nodes.name,
      size: nodes.size,
      updatedAt: nodes.updatedAt,
      trashedAt: nodes.trashedAt,
      encKey: fileVersions.encKey,
      tagged: sql<boolean>`${nodes.nameTag} is not null`,
    })
    .from(nodes)
    .leftJoin(fileVersions, eq(fileVersions.id, nodes.currentVersionId))
    .where(eq(nodes.vaultId, vault.id))
  return rows.map((r) => ({
    ...r,
    updatedAt: r.updatedAt.toISOString(),
    trashedAt: r.trashedAt?.toISOString() ?? null,
  }))
}

// Older items without a name tag get one; a clash with an existing duplicate
// just leaves that item untagged.
export async function setVaultTags(
  vaultId: string,
  tags: { id: string; tag: string }[]
): Promise<Result> {
  const { vault } = await myVault(vaultId)
  if (!vault || !Array.isArray(tags)) return { error: GONE }
  for (const t of tags.slice(0, 10_000)) {
    if (!UUID.test(t.id) || !isSealedName(t.tag)) continue
    await db
      .update(nodes)
      .set({ nameTag: t.tag })
      .where(and(inVault(vault.id, [t.id]), isNull(nodes.nameTag)))
      .catch((e) => {
        if (!isClash(e)) throw e
      })
  }
  return {}
}

// Folders in order, parents first. `parent` is an existing folder id, null for
// the vault root, or the `key` of an earlier folder in the same call. All or
// nothing.
export async function createVaultFolders(
  vaultId: string,
  folders: { key: string; parent: string | null; name: string; tag: string }[]
): Promise<Result & { ids?: Record<string, string> }> {
  const { me, vault } = await myVault(vaultId)
  if (!vault || !Array.isArray(folders) || folders.length > 10_000)
    return { error: GONE }
  if (!folders.every((f) => isSealedName(f.name) && isSealedName(f.tag)))
    return { error: "That folder name doesn't look right." }
  for (const f of folders)
    if (
      (f.parent === null || !folders.some((o) => o.key === f.parent)) &&
      !(await isOpenFolder(me.id, f.parent, vault.id))
    )
      return { error: GONE }
  try {
    return await db.transaction(async (tx) => {
      const ids: Record<string, string> = {}
      for (const f of folders) {
        const [row] = await tx
          .insert(nodes)
          .values({
            ownerId: me.id,
            vaultId: vault.id,
            parentId: f.parent === null ? null : (ids[f.parent] ?? f.parent),
            kind: "folder",
            name: f.name,
            nameTag: f.tag,
          })
          .returning({ id: nodes.id })
        ids[f.key] = row.id
      }
      return { ids }
    })
  } catch (e) {
    if (isClash(e)) return { error: TAKEN }
    throw e
  }
}

export async function renameVaultNode(
  vaultId: string,
  id: string,
  name: string,
  tag: string
): Promise<Result> {
  const { vault } = await myVault(vaultId)
  if (!vault || !UUID.test(id)) return { error: GONE }
  if (!isSealedName(name) || !isSealedName(tag))
    return { error: "That name doesn't look right." }
  try {
    await db
      .update(nodes)
      .set({ name, nameTag: tag, updatedAt: new Date() })
      .where(inVault(vault.id, [id]))
  } catch (e) {
    if (isClash(e)) return { error: TAKEN }
    throw e
  }
  return {}
}

export async function moveVaultNodes(
  vaultId: string,
  rawIds: string[],
  parentId: string | null
): Promise<Result> {
  const { me, vault } = await myVault(vaultId)
  const ids = cleanIds(rawIds)
  if (!vault || !(await isOpenFolder(me.id, parentId, vault.id)))
    return { error: GONE }
  if (parentId) {
    const up = await db.execute<{ id: string }>(sql`
      with recursive up as (
        select id, parent_id from nodes where id = ${parentId}
        union all
        select n.id, n.parent_id from nodes n join up on n.id = up.parent_id
      )
      select id from up`)
    if (up.some((r) => ids.includes(r.id)))
      return { error: "A folder can't go inside itself." }
  }
  try {
    await db
      .update(nodes)
      .set({ parentId, updatedAt: new Date() })
      .where(and(inVault(vault.id, ids), isNull(nodes.trashedAt)))
  } catch (e) {
    if (isClash(e))
      return { error: "Something with that name is already in that folder." }
    throw e
  }
  return {}
}

export async function deleteVaultNodes(
  vaultId: string,
  rawIds: string[]
): Promise<Result> {
  const { vault } = await myVault(vaultId)
  const ids = cleanIds(rawIds)
  if (!vault) return { error: GONE }
  if (ids.length) await deleteNodes(inVault(vault.id, ids))
  return {}
}

// The vault's own trash, the same way as My files: one timestamp for an item
// and everything inside it.
export async function trashVaultNodes(
  vaultId: string,
  rawIds: string[]
): Promise<Result> {
  const { me, vault } = await myVault(vaultId)
  const ids = cleanIds(rawIds)
  if (!vault) return { error: GONE }
  if (!ids.length) return {}
  const rows = await db
    .select({ id: nodes.id })
    .from(nodes)
    .where(inVault(vault.id, ids))
  await trashNodes(
    db,
    me.id,
    rows.map((r) => r.id)
  )
  return {}
}

// Back where it was, or the vault root if its folder is still in the trash.
// Items whose name is taken there now stay in the trash; `kept` counts them.
export async function restoreVaultNodes(
  vaultId: string,
  rawIds: string[]
): Promise<Result & { kept?: number }> {
  const { me, vault } = await myVault(vaultId)
  const ids = cleanIds(rawIds)
  if (!vault) return { error: GONE }
  if (!ids.length) return {}
  const rows = await db
    .select({ id: nodes.id })
    .from(nodes)
    .where(inVault(vault.id, ids))
  let kept = 0
  for (const { id } of rows)
    await db
      .transaction((tx) => restoreNode(tx, me.id, id))
      .catch((e) => {
        if (!isClash(e)) throw e
        kept++
      })
  return { kept }
}

// A token per target folder for uploading files of these plaintext sizes.
// Space is checked for all of them together.
export async function planVaultUpload(
  vaultId: string,
  groups: { parentId: string | null; sizes: number[] }[]
): Promise<Result & { tokens?: string[] }> {
  const { me, vault } = await myVault(vaultId)
  if (!vault || !Array.isArray(groups) || groups.length > 10_000)
    return { error: GONE }
  const sizes = groups.flatMap((g) => g.sizes)
  if (sizes.some((s) => !Number.isSafeInteger(s) || s < 0))
    return { error: "Those files don't look right." }
  for (const g of groups)
    if (!(await isOpenFolder(me.id, g.parentId, vault.id)))
      return { error: GONE }
  const cipher = sizes.map(cipherSize)
  const { maxUploadBytes } = await uploadLimits()
  if (maxUploadBytes !== null && cipher.some((s) => s > maxUploadBytes))
    return {
      error: `A file is larger than the ${sizeLabel(maxUploadBytes)} upload limit.`,
    }
  const left = await spaceLeft(me.id)
  const total = cipher.reduce((a, b) => a + b, 0)
  if (left !== null && total > left)
    return {
      error: `Not enough space: ${formatBytes(left)} left in this account.`,
    }
  const now = Date.now()
  return {
    tokens: groups.map((g) =>
      signUploadToken(me.id, g.parentId, now, { v: vault.id })
    ),
  }
}

// Where to fetch a vault file's ciphertext, and its wrapped file key.
export async function vaultFileUrl(
  vaultId: string,
  id: string
): Promise<{ url: string; encKey: string; size: number } | null> {
  const { vault } = await myVault(vaultId)
  if (!vault || !UUID.test(id)) return null
  const [row] = await db
    .select({
      key: fileVersions.s3Key,
      encKey: fileVersions.encKey,
      size: nodes.size,
    })
    .from(nodes)
    .innerJoin(fileVersions, eq(fileVersions.id, nodes.currentVersionId))
    .where(and(inVault(vault.id, [id]), eq(nodes.kind, "file")))
  if (!row?.encKey) return null
  return {
    url: await presignGet(row.key, "vault.bin", { expiresIn: 12 * 3600 }),
    encKey: row.encKey,
    size: row.size,
  }
}
