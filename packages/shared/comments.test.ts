// Run: node --test packages/shared/comments.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import { commentParts, decodeMentions, encodeMentions, formatAt, matchPeople, mentionIds, mentionQuery } from "./comments.ts"

const people = [
  { id: "u1", name: "Ana" },
  { id: "u2", name: "Ana Smith" },
]
const nameOf = (id: string) => people.find((p) => p.id === id)?.name

test("mentions round-trip, longest name first", () => {
  const body = encodeMentions("hi @Ana Smith and @Ana, also @Anastasia", people)
  assert.equal(body, "hi <@u2> and <@u1>, also @Anastasia")
  assert.deepEqual(mentionIds(body + " <@u1>"), ["u2", "u1"])
  assert.equal(decodeMentions(body, nameOf), "hi @Ana Smith and @Ana, also @Anastasia")
})

test("parts split mentions and links, trailing punctuation stays text", () => {
  assert.deepEqual(commentParts("see https://x.org/a?b=1. <@u9>!", nameOf), [
    { text: "see " },
    { link: "https://x.org/a?b=1" },
    { text: ". " },
    { mention: "u9", name: "someone" },
    { text: "!" },
  ])
})

test("the @query at the caret", () => {
  assert.deepEqual(mentionQuery("hey @an", 7), { start: 4, query: "an" })
  assert.equal(mentionQuery("mail a@b", 8), null)
  assert.deepEqual(matchPeople(people, "smi").map((p) => p.id), ["u2"])
  assert.deepEqual(matchPeople(people, "an").map((p) => p.id), ["u1", "u2"])
})

test("times", () => {
  assert.equal(formatAt(83), "1:23")
  assert.equal(formatAt(3723), "1:02:03")
})
