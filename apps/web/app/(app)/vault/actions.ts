"use server"

import { revalidatePath } from "next/cache"

import * as svc from "@/lib/services/vault"
import { requireMember } from "@/lib/session"

export type { VaultNode } from "@/lib/services/vault"
type Result = svc.Result

export async function createVault(input: svc.VaultKeys & { name: string }) {
  return svc.createVault(await requireMember(), input)
}

// A new passphrase: the same vault key, wrapped again under a new salt.
export async function updateVaultKey(
  vaultId: string,
  input: { salt: string; wrapped: string; kdf: { t: number; m: number } }
): Promise<Result> {
  return svc.updateVaultKey(await requireMember(), vaultId, input)
}

// The browser checked the passphrase and the typed name first; the server
// can't, since it never sees the passphrase.
export async function deleteVault(vaultId: string): Promise<Result> {
  const r = await svc.deleteVault(await requireMember(), vaultId)
  if (!r.error) revalidatePath("/", "layout")
  return r
}

// For "Move to vault…" in My files.
export async function myVaults() {
  return svc.myVaults(await requireMember())
}

// The whole vault in one go; the browser decrypts names and builds the tree.
export async function vaultTree(vaultId: string) {
  return svc.vaultTree(await requireMember(), vaultId)
}

// Older items without a name tag get one; a clash with an existing duplicate
// just leaves that item untagged.
export async function setVaultTags(
  vaultId: string,
  tags: { id: string; tag: string }[]
): Promise<Result> {
  return svc.setVaultTags(await requireMember(), vaultId, tags)
}

// Folders in order, parents first. All or nothing.
export async function createVaultFolders(
  vaultId: string,
  folders: { key: string; parent: string | null; name: string; tag: string }[]
): Promise<Result & { ids?: Record<string, string> }> {
  return svc.createVaultFolders(await requireMember(), vaultId, folders)
}

export async function renameVaultNode(
  vaultId: string,
  id: string,
  name: string,
  tag: string
): Promise<Result> {
  return svc.renameVaultNode(await requireMember(), vaultId, id, name, tag)
}

export async function moveVaultNodes(
  vaultId: string,
  rawIds: string[],
  parentId: string | null
): Promise<Result> {
  return svc.moveVaultNodes(await requireMember(), vaultId, rawIds, parentId)
}

export async function deleteVaultNodes(
  vaultId: string,
  rawIds: string[]
): Promise<Result> {
  return svc.deleteVaultNodes(await requireMember(), vaultId, rawIds)
}

// The vault's own trash, the same way as My files.
export async function trashVaultNodes(
  vaultId: string,
  rawIds: string[]
): Promise<Result> {
  return svc.trashVaultNodes(await requireMember(), vaultId, rawIds)
}

// Back where it was, or the vault root if its folder is still in the trash.
export async function restoreVaultNodes(
  vaultId: string,
  rawIds: string[]
): Promise<Result & { kept?: number }> {
  return svc.restoreVaultNodes(await requireMember(), vaultId, rawIds)
}

// A token per target folder for uploading files of these plaintext sizes.
export async function planVaultUpload(
  vaultId: string,
  groups: { parentId: string | null; sizes: number[] }[]
): Promise<Result & { tokens?: string[] }> {
  return svc.planVaultUpload(await requireMember(), vaultId, groups)
}

// Where to fetch a vault file's ciphertext, and its wrapped file key.
export async function vaultFileUrl(vaultId: string, id: string) {
  return svc.vaultFileUrl(await requireMember(), vaultId, id)
}
