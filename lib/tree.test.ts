// Run: node --env-file=.env.local --test lib/tree.test.ts
// Needs the dev Postgres; everything happens in a transaction that is rolled back.
import assert from "node:assert/strict"
import { test } from "node:test"

import { drizzle } from "drizzle-orm/postgres-js"
import { sql } from "drizzle-orm"
import postgres from "postgres"

const { restoreNode, trashNodes } = await import("./tree.ts")

test("trash and restore keep what went in together, together", async () => {
  const client = postgres(process.env.DATABASE_URL!)
  const db = drizzle(client)
  const rollback = new Error("rollback")
  try {
    await db.transaction(async (tx) => {
      const me = "tree-test-user"
      await tx.execute(
        sql`insert into "user" (id, name, email, status) values (${me}, 'T', 'tree-test@example.invalid', 'active')`
      )
      const folder = async (name: string, parent: string | null) => {
        const [r] = await tx.execute<{ id: string }>(
          sql`insert into nodes (owner_id, parent_id, kind, name) values (${me}, ${parent}, 'folder', ${name}) returning id`
        )
        return r.id
      }
      const trashed = async () =>
        (
          await tx.execute<{ name: string }>(
            sql`select name from nodes where owner_id = ${me} and trashed_at is not null order by name`
          )
        ).map((r) => r.name)
      const parentOf = async (id: string) =>
        (
          await tx.execute<{ p: string | null }>(
            sql`select parent_id as p from nodes where id = ${id}`
          )
        )[0].p

      // A/{B/{c}, d}
      const a = await folder("A", null)
      const b = await folder("B", a)
      await folder("c", b)
      const d = await folder("d", a)

      await trashNodes(tx, me, [d], new Date("2026-01-01"))
      await trashNodes(tx, me, [a], new Date("2026-01-02"))
      assert.deepEqual(await trashed(), ["A", "B", "c", "d"])

      // Restoring A brings back B and c, but not d, which was trashed on its own.
      assert.equal(await restoreNode(tx, me, a), true)
      assert.deepEqual(await trashed(), ["d"])
      assert.equal(await parentOf(d), a)

      // d's folder is back, so d returns into it.
      await restoreNode(tx, me, d)
      assert.equal(await parentOf(d), a)

      // A child restored while its folder is still trashed lands at the root.
      await trashNodes(tx, me, [a], new Date("2026-01-03"))
      await restoreNode(tx, me, b)
      assert.equal(await parentOf(b), null)

      // A name clash at the destination throws, and the savepoint undoes it.
      await folder("d", null)
      await assert.rejects(
        tx.transaction((s) => restoreNode(s, me, d)),
        (e: { cause?: { code?: string } }) => e.cause?.code === "23505"
      )
      assert.deepEqual(await trashed(), ["A", "d"])

      throw rollback
    })
  } catch (e) {
    if (e !== rollback) throw e
  } finally {
    await client.end()
  }
})
