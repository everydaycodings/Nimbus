import { expect, test, type Page } from "@playwright/test"

import { PASSWORD, signIn, unique } from "./helpers"

// Needs SECRETS_ROOT_KEY on the server and Secrets on (Admin → Secrets).
async function unlock(page: Page) {
  await page.goto("/secrets")
  await page.getByLabel("Your Nimbus password").fill(PASSWORD)
  await page.getByRole("button", { name: "Unlock", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Secrets", exact: true })).toBeVisible()
}

async function addRow(page: Page, key: string, value: string) {
  await page.getByRole("button", { name: "Add secret" }).click()
  await page.getByLabel("New secret key").fill(key)
  await page.getByLabel("New secret value").fill(value)
}

test("projects, secrets, reveal, overview, import, trash and the lock", async ({ page }) => {
  await signIn(page)
  await unlock(page)

  // A project starts with three environments.
  const name = unique("project")
  await page.getByRole("button", { name: "New project" }).first().click()
  await page.getByLabel("Name", { exact: true }).fill(name)
  await page.getByRole("button", { name: "Create project" }).click()
  await expect(page.getByRole("heading", { name })).toBeVisible()
  for (const e of ["Development", "Staging", "Production"])
    await expect(page.getByRole("button", { name: e, exact: true })).toBeVisible()

  // Add two secrets in Development, one of them referencing the other, then save.
  await page.getByRole("button", { name: "Development", exact: true }).click()
  await addRow(page, "DB_HOST", "db.dev.local")
  await page.getByRole("button", { name: "Add secret" }).click()
  await page.getByLabel("New secret key").first().fill("DB_URL")
  await page.getByLabel("New secret value").first().fill("pg://${DB_HOST}:5432")
  await expect(page.getByText("2 unsaved changes")).toBeVisible()
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page.getByText("unsaved change")).toBeHidden()

  // Values are masked until clicked; revealing shows the resolved reference.
  await expect(page.getByLabel("Value of DB_HOST", { exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "Reveal value of DB_URL" }).first().click()
  await expect(page.getByLabel("Value of DB_URL", { exact: true })).toHaveValue("pg://${DB_HOST}:5432")
  await page.getByRole("button", { name: "Details for DB_URL" }).click()
  await expect(page.getByText("pg://db.dev.local:5432")).toBeVisible()

  // A typed value is validated on save.
  await page.getByLabel("Type", { exact: true }).selectOption("number")
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page.getByText("Not a number.")).toBeVisible()
  await page.getByRole("button", { name: "Discard" }).click()

  // A circular reference is refused.
  await page.getByRole("button", { name: "Reveal value of DB_HOST" }).first().click()
  await page.getByLabel("Value of DB_HOST", { exact: true }).fill("${DB_URL}")
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page.getByText(/Circular reference/).first()).toBeVisible()
  await page.getByRole("button", { name: "Discard" }).click()

  // Overview: Development has the keys, Staging is missing them.
  await page.getByRole("button", { name: "Overview" }).click()
  await expect(page.getByRole("button", { name: /DB_HOST is missing in Staging/ })).toBeVisible()

  // Import a .env into Staging with a preview.
  await page.getByRole("button", { name: "Staging", exact: true }).click()
  await page.getByRole("button", { name: "Import" }).click()
  await page.getByLabel("Paste here").fill("DB_HOST=db.staging\nNEW_ONE=1\nNEW_ONE=2")
  await page.getByRole("button", { name: "Preview" }).click()
  await expect(page.getByText("2 new")).toBeVisible()
  await expect(page.getByText("Duplicate (later one wins)")).toBeVisible()
  await page.getByRole("button", { name: /Import 2 secrets/ }).click()
  await expect(page.getByLabel("Key of NEW_ONE")).toBeVisible()

  // Search finds names, never values.
  await page.getByLabel("Search key names, comments and tags").fill("NEW_")
  await expect(page.getByText("1 match")).toBeVisible()
  await page.getByLabel("Search key names, comments and tags").fill("db.staging")
  await expect(page.getByText(/Nothing matches/)).toBeVisible()
  await page.getByRole("button", { name: "Clear search" }).click()

  // Delete goes to the trash and comes back.
  await page.getByRole("button", { name: "Delete NEW_ONE" }).click()
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page.getByLabel("Key of NEW_ONE")).toHaveCount(0)
  await page.getByRole("button", { name: /^Trash/ }).click()
  await page.getByLabel("Select NEW_ONE").check()
  await page.getByRole("button", { name: "Restore" }).click()
  await expect(page.getByText("Trash is empty")).toBeVisible()

  // The server enforces the lock, not just the page.
  const open = await page.request.get("/api/v1/secrets/projects")
  expect(open.status()).toBe(200)
  await page.getByRole("button", { name: "Lock now" }).click()
  await expect(page.getByRole("heading", { name: "Secrets are locked" })).toBeVisible()
  const locked = await page.request.get("/api/v1/secrets/projects")
  expect(locked.status()).toBe(423)

  // Clean up.
  await unlock(page)
  await page.getByRole("link", { name: new RegExp(name) }).click()
  await page.getByRole("button", { name: "Project settings" }).click()
  await page.getByRole("menuitem", { name: "Delete project" }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Delete project" }).click()
  await expect(page).toHaveURL(/\/secrets$/)
})

test("phone width keeps rows readable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 })
  await signIn(page)
  await unlock(page)
  const scroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  expect(scroll).toBe(true)
})
