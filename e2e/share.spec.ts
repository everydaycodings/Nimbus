import { expect, test } from "@playwright/test"

import { OTHER, menu, newFolder, row, signIn, unique, upload } from "./helpers"

test("share a folder with a member, who can open it", async ({
  page,
  browser,
}) => {
  await signIn(page)
  const folder = unique("share")
  await newFolder(page, folder)
  await row(page, folder).dblclick()
  await upload(page, "notes.txt", "shared notes")
  await page.goto("/")

  await menu(page, folder, "Share…")
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("combobox", { name: "Add people" }).fill(OTHER)
  await dialog.getByRole("option").filter({ hasText: OTHER }).click()
  await dialog.getByRole("button", { name: "Share", exact: true }).click()
  await expect(dialog.getByText(OTHER)).toBeVisible()
  await page.keyboard.press("Escape")

  // The other member, in a browser of their own.
  const them = await (await browser.newContext()).newPage()
  await signIn(them, OTHER)
  await them.goto("/shared")
  await row(them, folder).dblclick()
  await row(them, "notes.txt").dblclick()
  await expect(them.getByText("shared notes")).toBeVisible()
  await them.context().close()

  await menu(page, folder, /trash/i)
  await expect(row(page, folder)).toBeHidden()
})
