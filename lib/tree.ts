// Trash and restore for the node tree. Plain SQL with no `@/` imports, so
// lib/tree.test.ts can run it under node --test inside a rolled-back transaction.
import { sql } from "drizzle-orm"

import type { db as Db } from "./db"

type Exec = Pick<typeof Db, "execute">

// Stamps the items and everything inside them that isn't already in the trash,
// all with one timestamp, so restore can tell what went in together.
export async function trashNodes(
  db: Exec,
  ownerId: string,
  ids: string[],
  at = new Date()
) {
  if (!ids.length) return
  await db.execute(sql`
    with recursive t as (
      select id from nodes
      where owner_id = ${ownerId} and id in ${ids} and trashed_at is null
      union
      select n.id from nodes n join t on n.parent_id = t.id
      where n.trashed_at is null
    )
    update nodes set trashed_at = ${at.toISOString()}
    where id in (select id from t)`)
}

// Brings an item back with exactly what was trashed alongside it. If its folder
// is still in the trash, it returns to the root instead. Run it in a transaction:
// a name clash at the destination throws from the second statement.
export async function restoreNode(db: Exec, ownerId: string, id: string) {
  const restored = await db.execute(sql`
    with recursive t as (
      select id, trashed_at as at from nodes
      where owner_id = ${ownerId} and id = ${id} and trashed_at is not null
      union
      select n.id, t.at from nodes n join t on n.parent_id = t.id
      where n.trashed_at = t.at
    )
    update nodes set trashed_at = null where id in (select id from t)
    returning id`)
  if (!restored.length) return false
  await db.execute(sql`
    update nodes set parent_id = null
    where id = ${id} and parent_id in (
      select id from nodes where trashed_at is not null
    )`)
  return true
}
