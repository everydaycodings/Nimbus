import { expect, test } from "@playwright/test"

import { row, signIn, unique } from "./helpers"

const PASS = "correct horse battery staple e2e"

test("make a vault, upload into it, lock, unlock, then delete it", async ({
  page,
}) => {
  await signIn(page)
  const name = unique("vault")
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

  const chooser = page.waitForEvent("filechooser")
  await page.getByRole("button", { name: "Upload" }).click()
  await page.getByRole("menuitem", { name: "Files" }).click()
  await (
    await chooser
  ).setFiles({
    name: "secret.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("only my browser can read this"),
  })
  await expect(row(page, "secret.txt")).toBeVisible()

  // Locked, the name is gone; the passphrase brings it back and it decrypts.
  await page.getByRole("button", { name: "Lock" }).click()
  await page.getByLabel("Passphrase").fill(PASS)
  await page.getByRole("button", { name: "Unlock" }).click()
  await row(page, "secret.txt").dblclick()
  await expect(page.getByText("only my browser can read this")).toBeVisible()
  await page.keyboard.press("Escape")

  await page.getByRole("button", { name: "Vault settings" }).click()
  await page.getByRole("menuitem", { name: "Delete vault…" }).click()
  await dialog.getByLabel("Passphrase").fill(PASS)
  await dialog.getByLabel(/to confirm/).fill(name)
  await dialog.getByRole("button", { name: "Delete vault" }).click()
  await expect(page).toHaveURL(/\/vault$/)
  await expect(page.getByText(name)).toBeHidden()
})
