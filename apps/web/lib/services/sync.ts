import "server-only"

import { sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { getFolder } from "@/lib/files"
import type { Me } from "@/lib/session"

export type TreeEntry = {
  id: string
  /** Relative to the folder asked about, `/`-separated. */
  path: string
  kind: "file" | "folder"
  size: number
  modified: string
  /** Current version's SHA-256; null for folders and for files finished without one. */
  sha256: string | null
  versionId: string | null
}
export type TreeResponse = { entries: TreeEntry[]; truncated: boolean }

const MAX = 50_000

// Everything under a folder (null: My files) in one query, for folder sync and export.
// Null if the folder isn't there or isn't mine to see.
export async function folderTree(me: Me, folderId: string | null): Promise<TreeResponse | null> {
  if (folderId && !(await getFolder(me.id, folderId))) return null
  const start = folderId
    ? sql`n.parent_id = ${folderId}`
    : sql`n.parent_id is null and n.owner_id = ${me.id}`
  const rows = await db.execute<{
    id: string
    kind: "file" | "folder"
    path: string
    size: string
    updated_at: string
    version_id: string | null
    sha256: string | null
  }>(sql`
    with recursive t as (
      select n.id, n.kind, n.name::text as path, n.size, n.updated_at, n.current_version_id
      from nodes n
      where ${start} and n.trashed_at is null and n.vault_id is null
      union all
      select n.id, n.kind, t.path || '/' || n.name, n.size, n.updated_at, n.current_version_id
      from nodes n join t on n.parent_id = t.id
      where n.trashed_at is null
    )
    select t.id, t.kind, t.path, t.size, t.updated_at, v.id as version_id, v.sha256
    from t left join file_versions v on v.id = t.current_version_id and t.kind = 'file'
    order by t.path limit ${MAX + 1}`)
  return {
    truncated: rows.length > MAX,
    entries: rows.slice(0, MAX).map((r) => ({
      id: r.id,
      path: r.path,
      kind: r.kind,
      size: Number(r.size),
      modified: new Date(r.updated_at).toISOString(),
      sha256: r.sha256 ?? null,
      versionId: r.version_id ?? null,
    })),
  }
}
