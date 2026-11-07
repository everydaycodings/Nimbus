import { expect, test, type Page } from "@playwright/test"

import { menu, row, signIn, unique } from "./helpers"

const PASS = "correct horse battery staple e2e"
const LINK_PASS = "a link passphrase for e2e"

async function makeVault(page: Page, name: string) {
  await page.goto("/vault")
  await page.getByRole("button", { name: "New vault" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("checkbox").check()
  await dialog.getByRole("button", { name: "Continue" }).click()
  await dialog.getByLabel("Vault name").fill(name)
  await dialog.getByLabel("Passphrase", { exact: true }).fill(PASS)
  await dialog.getByLabel("Repeat it").fill(PASS)
  await dialog.getByRole("button", { name: "Continue" }).click()
  await dialog.getByRole("button", { name: "Copy", exact: true }).click()
  await dialog.getByRole("button", { name: "Create vault" }).click()
  await expect(page).toHaveURL(/\/vault\/[0-9a-f-]+/)
}

test("share a vault file by link, with a passphrase, then revoke it", async ({
  page,
  browser,
}) => {
  await signIn(page)
  const name = unique("vault link")
  await makeVault(page, name)
  const chooser = page.waitForEvent("filechooser")
  await page.getByRole("button", { name: "Upload" }).click()
  await page.getByRole("menuitem", { name: "Files" }).click()
  await (
    await chooser
  ).setFiles({
    name: "secret.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("decrypted in the visitor's browser"),
  })
  await expect(row(page, "secret.txt")).toBeVisible()

  // Link alone: the key rides in the #.
  await menu(page, "secret.txt", "Share link…")
  const dialog = page.getByRole("dialog", { name: /Share link/ })
  await dialog.getByRole("button", { name: "Create link" }).click()
  const url = await dialog
    .getByRole("textbox", { name: "Link", exact: true })
    .inputValue()
  expect(url).toMatch(/\/v\/[\w-]+#[\w-]+$/)
  await dialog.getByRole("button", { name: "Done" }).click()

  const guest = await (await browser.newContext()).newPage()
  const errors: string[] = []
  guest.on("pageerror", (e) => errors.push(e.message))
  await guest.goto(url)
  await expect(guest.getByText("secret.txt")).toBeVisible()
  await guest.getByRole("button", { name: "Open secret.txt" }).click()
  await expect(
    guest.getByText("decrypted in the visitor's browser")
  ).toBeVisible()
  await guest.keyboard.press("Escape")
  // Without the key, nothing opens.
  await guest.goto(url.split("#")[0])
  await expect(guest.getByText("secret.txt")).toBeHidden()

  // A passphrase instead of the key in the link.
  await menu(page, "secret.txt", "Share link…")
  await dialog.getByText("A passphrase too").click()
  await dialog.getByLabel("Link passphrase").fill(LINK_PASS)
  await dialog.getByLabel("Repeat it").fill(LINK_PASS)
  await dialog.getByRole("button", { name: "Create link" }).click()
  const passUrl = await dialog
    .getByRole("textbox", { name: "Link", exact: true })
    .inputValue()
  expect(passUrl).not.toContain("#")
  await dialog.getByRole("button", { name: "Done" }).click()
  await guest.goto(passUrl)
  await guest.getByLabel("Passphrase").fill("wrong passphrase here")
  await guest.getByRole("button", { name: "Open files" }).click()
  await expect(guest.getByRole("alert")).toBeVisible()
  await guest.getByLabel("Passphrase").fill(LINK_PASS)
  await guest.getByRole("button", { name: "Open files" }).click()
  await expect(guest.getByText("secret.txt")).toBeVisible()

  // Revoke both; the links stop working.
  await page.getByRole("button", { name: "Vault settings" }).click()
  await page.getByRole("menuitem", { name: "Shared links…" }).click()
  const list = page.getByRole("dialog", { name: /links/i })
  await expect(list.getByText("secret.txt")).toHaveCount(2)
  // One at a time: each revoke reloads the list.
  for (const left of [1, 0]) {
    await list.getByRole("button", { name: "Revoke" }).first().click()
    await list.getByRole("button", { name: "Revoke" }).first().click()
    await expect(list.getByText("secret.txt")).toHaveCount(left)
  }
  await expect(list.getByText("secret.txt")).toHaveCount(0)
  await page.keyboard.press("Escape")
  await guest.goto(url)
  await expect(guest.getByText("This link doesn't work")).toBeVisible()
  expect(errors).toEqual([])
  await guest.context().close()

  await page.getByRole("button", { name: "Vault settings" }).click()
  await page.getByRole("menuitem", { name: "Delete vault…" }).click()
  const del = page.getByRole("dialog")
  await del.getByLabel("Passphrase").fill(PASS)
  await del.getByLabel(/to confirm/).fill(name)
  await del.getByRole("button", { name: "Delete vault" }).click()
  await expect(page).toHaveURL(/\/vault$/)
})
