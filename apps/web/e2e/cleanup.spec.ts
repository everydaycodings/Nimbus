import { expect, test } from "@playwright/test"

import { row, signIn, unique, upload } from "./helpers"

// Clean up: two identical files and a different one; the pair is grouped with the oldest kept, the extra goes to the Trash.
// Signs in as the dev admin (also a member). Needs the app, tusd and the worker running.
const EMAIL = process.env.E2E_ADMIN ?? "admin-test@example.invalid"
const PASS = process.env.E2E_ADMIN_PASSWORD ?? "admin-test-pass-123"

test("clean up: duplicates are grouped, the oldest is kept, the extra goes to the Trash", async ({ page }) => {
  const body = unique("same bytes")
  const first = unique("dup-first.txt")
  const second = unique("dup-second.txt")
  const other = unique("different.txt")

  await signIn(page, EMAIL, PASS)
  await page.goto("/")
  await upload(page, first, body)
  // A moment apart so "oldest" is unambiguous.
  await page.waitForTimeout(1100)
  await upload(page, second, body)
  await upload(page, other, `${body} but not the same`)

  await page.goto("/storage")
  await page.getByRole("link", { name: "Clean up" }).click()
  await expect(page.getByRole("heading", { name: "Clean up", level: 1 })).toBeVisible()

  // Uploads carry a browser hash; a file without one would show "Indexing" until the worker reads it.
  const group = page.getByRole("region").filter({ hasText: first })
  await expect(async () => {
    await page.reload()
    await expect(group).toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 60_000, intervals: [2000] })
  await expect(group).toContainText(second)
  await expect(group).not.toContainText(other)
  await expect(group.getByRole("checkbox", { name: `Select ${first}` })).not.toBeChecked()
  await expect(group.getByRole("checkbox", { name: `Select ${second}` })).toBeChecked()

  // Duplicates other runs left behind are pre-ticked too; leave those alone.
  const others = page.locator(`input[type=checkbox]:checked:not([aria-label="Select ${second}"])`)
  while (await others.count()) await others.first().uncheck()
  await page.getByRole("button", { name: /Move 1 to Trash/ }).click()
  await expect(page.getByText("Moved 1 file to the trash.")).toBeVisible()
  await expect(group).toHaveCount(0)

  await page.goto("/trash")
  await expect(row(page, second)).toBeVisible()
  await expect(row(page, first)).toHaveCount(0)
  await page.goto("/")
  await expect(row(page, first)).toBeVisible()
  await expect(row(page, other)).toBeVisible()
})

test("clean up: the other tabs open", async ({ page }) => {
  await signIn(page, EMAIL, PASS)
  for (const tab of ["Largest", "Not opened"]) {
    await page.goto("/more/cleanup")
    await page.getByRole("tab", { name: tab }).click()
    await expect(page.getByRole("tab", { name: tab })).toHaveAttribute("aria-current", "page")
  }
})
