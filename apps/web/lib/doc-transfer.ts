// Documents that move with a transferred folder or file. Not server-only: the test runs it on a transaction.
import { sql } from "drizzle-orm"

import type { db } from "@/lib/db"

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

// Documents under `nodeId` go to the new owner clean: the old owner's custom types, senders, reminders,
// duplicate links and watch folders stay behind. (Reads follow nodes.owner_id as well.)
export async function moveDocuments(tx: Tx, nodeId: string, to: string) {
  const sub = sql`with recursive t as (
    select id from nodes where id = ${nodeId}
    union all
    select n.id from nodes n join t on n.parent_id = t.id
  )`
  await tx.execute(sql`${sub}
    update documents d set owner_id = ${to}, sender_id = null, dup_of = null, reminded_at = null,
      type_id = (select x.id from doc_types x where x.id = d.type_id and x.owner_id is null)
    where d.node_id in (select id from t)`)
  await tx.execute(sql`${sub}
    update documents set dup_of = null where dup_of in (select id from t) and owner_id <> ${to}`)
  await tx.execute(sql`${sub}
    delete from doc_watch where node_id in (select id from t) and owner_id <> ${to}`)
}
