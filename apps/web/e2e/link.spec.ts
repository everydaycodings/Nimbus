import { expect, test } from "@playwright/test"

import { menu, newFolder, row, signIn, unique, upload } from "./helpers"

test("make a public link that opens without an account", async ({
  page,
  browser,
}) => {
  await signIn(page)
  const folder = unique("link")
  await newFolder(page, folder)
  await row(page, folder).dblclick()
  await upload(page, "public.txt", "anyone can read this")

  await menu(page, "public.txt", "Share…")
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("button", { name: "New link" }).click()
  await dialog.getByRole("button", { name: "Copy", exact: true }).click()
  const url = await page.evaluate(() => navigator.clipboard.readText())
  expect(url).toContain("/s/")
  await page.keyboard.press("Escape")

  // Signed out: a fresh browser with no cookies.
  const guest = await (await browser.newContext()).newPage()
  await guest.goto(url)
  await expect(guest.getByText("anyone can read this")).toBeVisible()
  await guest.context().close()

  await page.goto("/")
  await menu(page, folder, /trash/i)
  await expect(row(page, folder)).toBeHidden()
})
