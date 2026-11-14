// Run: node --env-file=.env.local --test lib/doc-transfer.test.ts
// Needs the dev Postgres; everything happens in a transaction that is rolled back.
import assert from "node:assert/strict"
import { test } from "node:test"

import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import { moveDocuments } from "./doc-transfer.ts"

test("a transferred document leaves nothing of the old owner behind", async () => {
  const client = postgres(process.env.DATABASE_URL!)
  const db = drizzle(client)
  try {
    await db.transaction(async (tx) => {
      const [a, b] = ["transfer-old", "transfer-new"]
      for (const u of [a, b])
        await tx.execute(sql`insert into "user" (id, name, email, status) values (${u}, 'T', ${u + "@example.invalid"}, 'active')`)
      const one = async <T extends Record<string, unknown>>(q: ReturnType<typeof sql>) => (await tx.execute<T>(q))[0]
      const folder = (await one<{ id: string }>(sql`insert into nodes (owner_id, kind, name) values (${a}, 'folder', 'F') returning id`)).id
      const file = (await one<{ id: string }>(sql`insert into nodes (owner_id, parent_id, kind, name, s3_key) values (${a}, ${folder}, 'file', 'x.pdf', 'k') returning id`)).id
      const type = (await one<{ id: string }>(sql`insert into doc_types (owner_id, name) values (${a}, 'Mine') returning id`)).id
      const sender = (await one<{ id: string }>(sql`insert into doc_senders (owner_id, name) values (${a}, 'Acme') returning id`)).id
      await tx.execute(sql`insert into documents (node_id, owner_id, type_id, sender_id, dup_of, reminded_at) values (${file}, ${a}, ${type}, ${sender}, ${folder}, now())`)
      await tx.execute(sql`insert into doc_watch (owner_id, node_id) values (${a}, ${folder})`)

      await tx.execute(sql`update nodes set owner_id = ${b} where id in (${folder}, ${file})`)
      await moveDocuments(tx as never, folder, b)

      const d = await one<{ owner_id: string; type_id: string | null; sender_id: string | null; dup_of: string | null; reminded_at: Date | null }>(
        sql`select * from documents where node_id = ${file}`
      )
      assert.equal(d.owner_id, b)
      assert.equal(d.type_id, null)
      assert.equal(d.sender_id, null)
      assert.equal(d.dup_of, null)
      assert.equal(d.reminded_at, null)
      assert.equal((await tx.execute(sql`select 1 from doc_watch where node_id = ${folder}`)).length, 0)
      throw new Error("rollback")
    })
  } catch (e) {
    if ((e as Error).message !== "rollback") throw e
  } finally {
    await client.end()
  }
})
