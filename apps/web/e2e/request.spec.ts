import { expect, test } from "@playwright/test"

import { menu, newFolder, row, signIn, unique } from "./helpers"

// Set when the instance sends email to a Mailpit (and the worker runs), e.g. http://localhost:8025.
const MAILPIT = process.env.E2E_MAILPIT

test("a file request takes files into a folder per person and emails a receipt", async ({
  page,
  browser,
}) => {
  await signIn(page)
  const folder = unique("request")
  await newFolder(page, folder)

  await menu(page, folder, "Request files…")
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByText("Uploads only")).toBeVisible()
  await dialog
    .getByLabel("Instructions for people sending files")
    .fill("Send your signed contract.")
  await dialog.getByLabel("Instructions for people sending files").blur()
  // These follow the server, so click and wait rather than check().
  for (const label of [
    "Ask for an email",
    "Put each person's files in a folder with their name",
    "PDFs",
  ]) {
    await dialog.getByLabel(label).click()
    await expect(dialog.getByLabel(label)).toBeChecked()
  }
  await dialog
    .getByRole("button", { name: "Copy", exact: true })
    .first()
    .click()
  const url = await page.evaluate(() => navigator.clipboard.readText())
  expect(url).toContain("/s/")
  await page.keyboard.press("Escape")

  const guest = await (await browser.newContext()).newPage()
  await guest.goto(url)
  await expect(guest.getByText("is asking for files")).toBeVisible()
  await expect(guest.getByText("Send your signed contract.")).toBeVisible()
  const choose = guest.getByRole("button", { name: "Choose files" })
  await expect(choose).toBeDisabled()
  const who = `Ana ${Date.now().toString(36)}`
  const email = `ana-${Date.now().toString(36)}@example.invalid`
  await guest.getByLabel("Your name").fill(who)
  await guest.getByLabel("Your email").fill(email)
  await expect(choose).toBeEnabled()

  const pick = async (name: string, mimeType: string) => {
    const chooser = guest.waitForEvent("filechooser")
    await choose.click()
    await (
      await chooser
    ).setFiles({ name, mimeType, buffer: Buffer.from("%PDF-1.4 test") })
  }
  await pick("notes.txt", "text/plain")
  await expect(guest.getByText("This link only takes PDFs.")).toBeVisible()
  await pick("contract.pdf", "application/pdf")
  const list = guest.getByRole("list", { name: "Files you sent" })
  await expect(list.getByText("contract.pdf")).toBeVisible()
  await expect(
    list
      .locator("li")
      .filter({ hasText: "contract.pdf" })
      .locator(".text-brand")
  ).toBeVisible()
  await guest.context().close()

  // The receipt reached the visitor.
  if (MAILPIT)
    await expect
      .poll(async () => {
        const r = await fetch(
          `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`
        )
        return ((await r.json()) as { messages_count: number }).messages_count
      })
      .toBeGreaterThan(0)

  // The file landed in a folder named after them.
  await page.reload()
  await row(page, folder).dblclick()
  await page.waitForURL(/\/folders\//)
  await row(page, who).dblclick()
  await expect(row(page, "contract.pdf")).toBeVisible()

  await page.goto("/")
  await menu(page, folder, /trash/i)
  await expect(row(page, folder)).toBeHidden()
})
