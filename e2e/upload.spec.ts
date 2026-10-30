import { expect, test } from "@playwright/test"

import { menu, newFolder, row, signIn, unique, upload } from "./helpers"

test("upload a file, preview it, then trash and restore it", async ({
  page,
}) => {
  await signIn(page)
  const folder = unique("upload")
  await newFolder(page, folder)
  await row(page, folder).dblclick()
  await expect(page).toHaveURL(/\/folders\//)

  await upload(page, "hello.txt", "hello from the e2e suite")
  await row(page, "hello.txt").dblclick()
  await expect(page.getByText("hello from the e2e suite")).toBeVisible()
  await page.keyboard.press("Escape")

  await menu(page, "hello.txt", /trash/i)
  await expect(row(page, "hello.txt")).toBeHidden()
  await page.getByRole("button", { name: "Undo" }).click()
  await expect(row(page, "hello.txt")).toBeVisible()

  // Clean up: the folder goes to the trash.
  await page.goto("/")
  await menu(page, folder, /trash/i)
  await expect(row(page, folder)).toBeHidden()
})
