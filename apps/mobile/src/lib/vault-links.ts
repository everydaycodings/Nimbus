// Vault share links from the phone. The vault key never leaves Kotlin: it re-wraps each file's key
// under a fresh link key and seals the manifest (vaultLinkSeal); JS only moves the results.
import type { CreateVaultLinkRequest, CreateVaultLinkResponse, VaultLink, VaultLinksResponse } from "@nimbus/shared/api"
import { useQuery } from "@tanstack/react-query"

import { useApi, useInstance } from "./files"
import { native } from "./native"
import { vaultNative, type VaultNative } from "./vault"
import { withPaths, type VaultEntry } from "./vault-rules"

const MAX_FILES = 5000

type Api = ReturnType<typeof useApi>

// Needs the server to have links on and an APK new enough to seal them.
export function useCanShareLinks() {
  const { data } = useInstance()
  return !!vaultNative && typeof native?.vaultLinkSeal === "function" && data?.vaultLinks === true
}

export function useVaultLinks(vaultId: string) {
  const api = useApi()
  return useQuery({ queryKey: [api.id, "vault-links", vaultId], queryFn: () => api.get<VaultLinksResponse>(`/vaults/${vaultId}/links`) })
}

export type LinkChoice = { passphrase: string | null; expiresInDays: 1 | 7 | 30 | null }

// The link to send. Key links carry the key after the #; passphrase links don't.
export async function createVaultLink(api: Api, vn: VaultNative, vaultId: string, all: VaultEntry[], targets: VaultEntry[], choice: LinkChoice) {
  if (!native?.vaultLinkSeal) throw new Error("Update the Nimbus app to share vault links.")
  const files = withPaths(all, targets).filter((f) => f.entry.kind === "file")
  if (!files.length) throw new Error("There are no files to share in there.")
  if (files.length > MAX_FILES) throw new Error(`A link can hold up to ${MAX_FILES} files.`)
  if (files.some((f) => !f.entry.encKey || !f.entry.versionId)) throw new Error("Pull down to refresh the vault, then try again.")
  const sealed = JSON.parse(
    await native.vaultLinkSeal(
      api.id,
      vaultId,
      JSON.stringify(files.map((f) => ({ path: f.path, size: f.entry.size, mime: f.entry.mime, versionId: f.entry.versionId, encKey: f.entry.encKey }))),
      choice.passphrase
    )
  ) as { key: string | null; manifest: string; kdfSalt: string | null; kdfIterations: number | null; kdfMemory: number | null; wrappedLinkKey: string | null }
  const label = targets.length === 1 ? targets[0].name : `${targets.length} items`
  const body: CreateVaultLinkRequest = {
    manifest: sealed.manifest,
    label: JSON.parse(await vn.vaultSealName(api.id, vaultId, label, null)).sealed,
    versionIds: files.map((f) => f.entry.versionId!),
    expiresInDays: choice.expiresInDays,
    passphrase: sealed.wrappedLinkKey
      ? { salt: sealed.kdfSalt!, kdf: { t: sealed.kdfIterations!, m: sealed.kdfMemory! }, wrapped: sealed.wrappedLinkKey }
      : undefined,
  }
  const { token } = await api.post<CreateVaultLinkResponse>(`/vaults/${vaultId}/links`, body)
  return `${api.account.server}/v/${token}${sealed.key ? `#${sealed.key}` : ""}`
}

// Labels are sealed with the vault key; open them for the list.
export async function openLabels(api: Api, vn: VaultNative, vaultId: string, links: VaultLink[]) {
  const opened: ({ n: string } | null)[] = JSON.parse(await vn.vaultOpenNames(api.id, vaultId, links.map((l) => l.label)))
  return links.map((l, i) => ({ ...l, name: opened[i]?.n ?? "Link" }))
}
