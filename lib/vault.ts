import "server-only"

import { and, eq, sql, type SQL } from "drizzle-orm"

import { db } from "@/lib/db"
import { nodes, settings, vaults } from "@/lib/db/schema"
import { UUID } from "@/lib/files"
import { deleteNodes } from "@/lib/uploads"

export type VaultSummary = {
  id: string
  name: string
  items: number
  bytes: number
  createdAt: string
}

// Vaults with what's in them (trash included, since it's stored).
async function summaries(where: SQL) {
  const rows = await db.execute<{
    id: string
    owner_id: string
    name: string
    items: string
    bytes: string
    created_at: Date
  }>(sql`
    select v.id, v.owner_id, v.name, v.created_at,
      count(n.id) filter (where n.kind = 'file')::text as items,
      coalesce(sum(n.size) filter (where n.kind = 'file'), 0)::text as bytes
    from vaults v left join nodes n on n.vault_id = v.id
    where ${where}
    group by v.id order by lower(v.name)`)
  return rows.map((r) => ({
    ownerId: r.owner_id,
    id: r.id,
    name: r.name,
    items: Number(r.items),
    bytes: Number(r.bytes),
    createdAt: new Date(r.created_at).toISOString(),
  }))
}

export const listVaults = (ownerId: string): Promise<VaultSummary[]> =>
  summaries(sql`v.owner_id = ${ownerId}`)

export async function vaultsByOwner(ids: string[]) {
  const out = new Map<string, VaultSummary[]>()
  if (!ids.length) return out
  for (const { ownerId, ...v } of await summaries(sql`v.owner_id in ${ids}`))
    out.set(ownerId, [...(out.get(ownerId) ?? []), v])
  return out
}

// One of the owner's vaults with its wrapped keys, or null.
export async function getVault(ownerId: string, id: string) {
  if (!UUID.test(id)) return null
  const [row] = await db
    .select()
    .from(vaults)
    .where(and(eq(vaults.id, id), eq(vaults.ownerId, ownerId)))
  return row ?? null
}

export async function vaultPolicy() {
  const [row] = await db
    .select({
      enabled: settings.vaultsEnabled,
      cap: settings.maxVaultsPerMember,
    })
    .from(settings)
  return row ?? { enabled: true, cap: null }
}

// Everything inside goes first, so its S3 objects are cleaned up too.
export async function destroyVault(id: string) {
  await deleteNodes(eq(nodes.vaultId, id))
  await db.delete(vaults).where(eq(vaults.id, id))
}
