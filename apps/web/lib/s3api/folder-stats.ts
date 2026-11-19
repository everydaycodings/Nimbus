import "server-only"

import { sql } from "drizzle-orm"

import { db } from "@/lib/db"

// Files under a folder (not trashed), their bytes, and with `versions` the bytes of every version of them.
export async function folderStats(nodeId: string, versions = false) {
  const [r] = await db.execute<{ bytes: string; objects: string; all_bytes: string }>(sql`
    with recursive d as (
      select id, kind, size from nodes where id = ${nodeId}
      union all
      select n.id, n.kind, n.size from nodes n join d on n.parent_id = d.id
        where n.trashed_at is null
    )
    select coalesce(sum(size) filter (where kind = 'file'), 0)::text as bytes,
      count(*) filter (where kind = 'file')::text as objects,
      ${
        versions
          ? sql`coalesce((select sum(v.size) from file_versions v where v.node_id in (select id from d where kind = 'file')), 0)::text`
          : sql`'0'`
      } as all_bytes from d`)
  return { bytes: Number(r?.bytes ?? 0), objects: Number(r?.objects ?? 0), allBytes: Number(r?.all_bytes ?? 0) }
}
