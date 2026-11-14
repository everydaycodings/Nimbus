// Run: node --env-file=.env.local --test scripts/documents.test.ts
// Needs the dev Postgres. Makes a throwaway member and deletes it at the end.
import assert from "node:assert/strict"
import { after, test } from "node:test"

import { docsSweep } from "./documents.ts"
import { sql } from "./indexer.ts"

test("the sweep guesses, makes no sender, and never overwrites what the owner set", async () => {
  const me = `sweep-test-${Date.now()}`
  try {
    await sql`insert into "user" (id, name, email, status) values (${me}, 'T', ${me + "@example.invalid"}, 'active')`
    const [folder] = await sql<{ id: string }[]>`insert into nodes (owner_id, kind, name, system_kind) values (${me}, 'folder', 'Documents', 'documents') returning id`
    const [file] = await sql<{ id: string }[]>`insert into nodes (owner_id, parent_id, kind, name, s3_key, mime) values (${me}, ${folder.id}, 'file', 'a.pdf', 'k', 'application/pdf') returning id`
    const version = async (n: number, body: string) => {
      const [v] = await sql<{ id: string }[]>`insert into file_versions (node_id, s3_key, size, number) values (${file.id}, ${"k" + n}, 1, ${n}) returning id`
      await sql`update nodes set current_version_id = ${v.id} where id = ${file.id}`
      await sql`insert into node_content (node_id, version_id, body, source) values (${file.id}, ${v.id}, ${body}, 'pdf')
        on conflict (node_id) do update set version_id = excluded.version_id, body = excluded.body`
      return v.id
    }
    const row = async () =>
      (await sql<{ amount: number | null; doc_date: string | null; guess: { sender?: string }; sender_id: string | null; version_id: string | null }[]>`
        select amount::float8, doc_date::text, guess, sender_id, version_id from documents where node_id = ${file.id}`)[0]

    await version(1, "ACME SUPPLIES LTD\nInvoice\nInvoice date: 2025-03-14\nTotal due: $50.00")
    await docsSweep()
    let d = await row()
    assert.equal(d.amount, 50)
    assert.equal(d.sender_id, null, "a guessed sender is not made")
    assert.match(d.guess.sender ?? "", /acme/i)
    assert.equal((await sql`select 1 from doc_senders where owner_id = ${me}`).length, 0)

    // The owner sets the amount; the file gets a new version (and an admin re-run clears version_id).
    await sql`update documents set amount = 99, touched = array['amount'] where node_id = ${file.id}`
    await version(2, "ACME SUPPLIES LTD\nInvoice\nInvoice date: 2025-05-01\nTotal due: $50.00")
    await docsSweep()
    d = await row()
    assert.equal(d.amount, 99, "edit kept")
    assert.equal(d.doc_date, "2025-05-01", "untouched fields still follow the file")
    await sql`update documents set version_id = null where node_id = ${file.id}`
    await docsSweep()
    assert.equal((await row()).amount, 99, "kept through a re-run")
  } finally {
    await sql`delete from "user" where id = ${me}`
    await sql.end()
  }
})

// The worker's Redis queues keep the process open.
after(() => void setTimeout(() => process.exit(process.exitCode ?? 0), 100))
