import assert from "node:assert/strict"
import { test } from "node:test"

import type { MemoryYear, PhotoItem } from "@nimbus/shared/api"

import { memorySlides, yearsAgo } from "./memory-slides.ts"

const photo = (id: string, mime = "image/jpeg"): PhotoItem =>
  ({ id, kind: "file", name: mime.startsWith("video") ? `${id}.mp4` : `${id}.jpg`, mime, size: 1, starred: false, updatedAt: "", trashedAt: null, tags: [], version: "v", thumb: "t", sharedWithPeople: false, hasLink: false, takenAt: "2024-11-12T10:00:00Z" })

test("each year gets a title card before its photos", () => {
  const years: MemoryYear[] = [
    { year: 2025, yearsAgo: 1, items: [photo("a")] },
    { year: 2022, yearsAgo: 4, items: [photo("b"), photo("c")] },
  ]
  const slides = memorySlides(years)
  assert.deepEqual(slides.map((s) => (s.kind === "card" ? s.title : s.item.id)), ["1 year ago", "a", "4 years ago", "b", "c"])
  assert.equal(slides[0].kind === "card" && slides[0].caption, "2025 · 1 photo")
})

test("videos and empty years are left out", () => {
  const slides = memorySlides([{ year: 2020, yearsAgo: 6, items: [photo("v", "video/mp4")] }])
  assert.deepEqual(slides, [])
  assert.equal(yearsAgo(2), "2 years ago")
})
