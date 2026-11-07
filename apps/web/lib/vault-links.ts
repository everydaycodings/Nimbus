// Vault share links (/v/<token>): the public side. The server only ever holds the sealed
// manifest, the wrapped link key (passphrase mode) and which ciphertexts the link may fetch.
import "server-only"

import { and, eq, gt, isNull, or, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import {
  fileVersions,
  settings,
  user,
  vaultLinks,
  vaultLinkVersions,
} from "@/lib/db/schema"
import { UUID } from "@/lib/file-rules"

// A link that works right now: links on, not expired, owner still active.
export async function findVaultLink(token: string) {
  if (!/^[\w-]{10,64}$/.test(token)) return null
  const [row] = await db
    .select({
      id: vaultLinks.id,
      manifest: vaultLinks.manifest,
      kdfSalt: vaultLinks.kdfSalt,
      kdfIterations: vaultLinks.kdfIterations,
      kdfMemory: vaultLinks.kdfMemory,
      wrappedLinkKey: vaultLinks.wrappedLinkKey,
    })
    .from(vaultLinks)
    .innerJoin(user, eq(user.id, vaultLinks.ownerId))
    .innerJoin(settings, sql`true`)
    .where(
      and(
        eq(vaultLinks.token, token),
        eq(settings.vaultLinksEnabled, true),
        eq(user.status, "active"),
        or(isNull(vaultLinks.expiresAt), gt(vaultLinks.expiresAt, sql`now()`))
      )
    )
  return row ?? null
}

// Versions that still exist; a deleted one drops out of the link.
export async function linkVersionIds(linkId: string) {
  const rows = await db
    .select({ id: vaultLinkVersions.versionId })
    .from(vaultLinkVersions)
    .where(eq(vaultLinkVersions.linkId, linkId))
  return rows.map((r) => r.id)
}

export async function countView(linkId: string) {
  await db
    .update(vaultLinks)
    .set({ viewCount: sql`${vaultLinks.viewCount} + 1` })
    .where(eq(vaultLinks.id, linkId))
}

// The ciphertext's key in the bucket, only if this link lists the version.
export async function linkBlob(linkId: string, versionId: string) {
  if (!UUID.test(versionId)) return null
  const [row] = await db
    .select({ key: fileVersions.s3Key, size: fileVersions.size })
    .from(vaultLinkVersions)
    .innerJoin(fileVersions, eq(fileVersions.id, vaultLinkVersions.versionId))
    .where(
      and(
        eq(vaultLinkVersions.linkId, linkId),
        eq(vaultLinkVersions.versionId, versionId)
      )
    )
  return row ?? null
}
