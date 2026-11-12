import { expect, test, type Page } from "@playwright/test"

import { menu, newFolder, row, signIn, unique, upload } from "./helpers"

// datetime-local takes local time, to the minute.
const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16)

// The point in time is a minute boundary, with everything before it already done.
async function boundary(page: Page) {
  let t = Math.ceil(Date.now() / 6e4) * 6e4
  if (t - Date.now() < 3000) t += 6e4
  await page.waitForTimeout(t - Date.now() + 2000)
  return t
}

async function restoreTo(page: Page, folder: string, t: number) {
  await page.getByRole("button", { name: `More for ${folder}`, exact: true }).click()
  await page.getByRole("menuitem", { name: "Restore to a point in time…" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("Date and time").fill(local(new Date(t)))
  return dialog
}

async function openNew(page: Page, name: string) {
  const folder = unique(name)
  await signIn(page)
  await newFolder(page, folder)
  await row(page, folder).dblclick()
  await page.waitForURL(/\/folders\//)
  return folder
}

test("restore folders to a point in time, undo from the toast and from Activity", async ({ page }) => {
  test.setTimeout(240_000)
  const folder = await openNew(page, "restore")

  // Before: one to trash, one to rename, one to move into "den".
  await newFolder(page, "rock")
  await newFolder(page, "river")
  await newFolder(page, "moss")
  await newFolder(page, "den")
  const t = await boundary(page)

  await menu(page, "rock", "Move to trash")
  await expect(row(page, "rock")).toBeHidden()
  await menu(page, "river", "Rename")
  await page.getByRole("dialog").getByRole("textbox").fill("stream")
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click()
  await expect(row(page, "stream")).toBeVisible()
  await menu(page, "moss", /^Move$/)
  await page.getByRole("dialog").getByRole("button", { name: "den" }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Move here" }).click()
  await expect(row(page, "moss")).toBeHidden()
  await newFolder(page, "newer")

  // Preview, then restore.
  const dialog = await restoreTo(page, folder, t)
  await expect(dialog.getByText("Back from Trash · 1")).toBeVisible()
  await expect(dialog.getByText("Renamed back · 1")).toBeVisible()
  await expect(dialog.getByText("Moved back · 1")).toBeVisible()
  await dialog.getByRole("button", { name: "Restore", exact: true }).click()
  await expect(row(page, "rock")).toBeVisible()
  await expect(row(page, "river")).toBeVisible()
  await expect(row(page, "stream")).toBeHidden()
  await expect(row(page, "moss")).toBeVisible()
  await expect(row(page, "newer")).toBeVisible()

  // Undo from the toast.
  await page.getByRole("button", { name: "Undo" }).click()
  await expect(row(page, "stream")).toBeVisible()
  await expect(row(page, "rock")).toBeHidden()
  await expect(row(page, "moss")).toBeHidden()

  // Again, then undo from the folder's Activity.
  const again = await restoreTo(page, folder, t)
  await expect(again.getByText("Back from Trash · 1")).toBeVisible()
  await again.getByRole("button", { name: "Restore", exact: true }).click()
  await expect(row(page, "rock")).toBeVisible()
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "My files" }).click()
  await menu(page, folder, "Details")
  const details = page.getByRole("dialog")
  const activity = details.getByRole("region", { name: "Activity" })
  await expect(activity.getByText(/Restored to/).first()).toBeVisible()
  await activity.getByRole("button", { name: "Undo" }).click()
  await expect(activity.getByRole("button", { name: "Undo" })).toBeHidden()
})

test("restore points a file back at its older version", async ({ page }) => {
  test.setTimeout(240_000)
  const folder = await openNew(page, "restore versions")
  await upload(page, "keep.txt", "one")
  const t = await boundary(page)

  const chooser = page.waitForEvent("filechooser")
  await page.getByRole("button", { name: "New", exact: true }).click()
  await page.getByRole("menuitem", { name: "File upload" }).click()
  await (await chooser).setFiles({ name: "keep.txt", mimeType: "text/plain", buffer: Buffer.from("twotwo") })
  await page.getByRole("button", { name: "New version" }).click()
  await expect(row(page, "keep.txt")).toContainText("6 B")

  const dialog = await restoreTo(page, folder, t)
  await expect(dialog.getByText("Older versions · 1")).toBeVisible()
  await dialog.getByRole("button", { name: "Restore", exact: true }).click()
  await expect(row(page, "keep.txt")).toContainText("3 B")
  await page.getByRole("button", { name: "Undo" }).click()
  await expect(row(page, "keep.txt")).toContainText("6 B")
})
