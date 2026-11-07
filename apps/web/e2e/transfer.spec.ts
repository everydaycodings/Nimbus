import { expect, test } from "@playwright/test"

import { menu, newFolder, row, signIn, unique, upload } from "./helpers"

test("send a transfer, download it once, then it closes; revoke frees it", async ({
  page,
  browser,
}) => {
  await signIn(page)
  const folder = unique("transfer")
  await newFolder(page, folder)
  await row(page, folder).dblclick()
  await page.waitForURL(/\/folders\//)
  await upload(page, "report.txt", "quarterly numbers")

  await menu(page, "report.txt", "Send with Transfer…")
  const dialog = page.getByRole("dialog", { name: /transfer/i })
  await expect(dialog.getByText("report.txt")).toBeVisible()
  // Plus one from this computer, uploaded straight into the transfer.
  const chooser = page.waitForEvent("filechooser")
  await dialog.getByRole("button", { name: "From this computer" }).click()
  await (
    await chooser
  ).setFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("from my desk"),
  })
  const title = unique("Q3 files")
  await dialog.getByLabel("Title (optional)").fill(title)
  await dialog.getByLabel("Message (optional)").fill("Here are the numbers.")
  await dialog.getByLabel("Download limit").fill("1")
  await dialog.getByRole("button", { name: "Send" }).click()
  await expect(dialog.getByText("Transfer sent")).toBeVisible({
    timeout: 30_000,
  })
  const url = await dialog
    .getByRole("textbox", { name: "Link", exact: true })
    .inputValue()
  expect(url).toContain("/t/")
  await dialog.getByRole("button", { name: "Done" }).click()

  const guest = await (await browser.newContext()).newPage()
  const errors: string[] = []
  guest.on("pageerror", (e) => errors.push(e.message))
  await guest.goto(url)
  await expect(guest.getByText(title)).toBeVisible()
  await expect(guest.getByText("Here are the numbers.")).toBeVisible()
  await expect(guest.getByText("report.txt")).toBeVisible()
  await expect(guest.getByText("notes.txt")).toBeVisible()
  const dl = guest.waitForEvent("download")
  await guest.getByRole("button", { name: "Download all" }).click()
  expect((await dl).suggestedFilename()).toMatch(/\.zip$/)
  expect(errors).toEqual([])
  await guest.context().close()

  // The limit was 1: someone else now finds it closed.
  const late = await (await browser.newContext()).newPage()
  await late.goto(url)
  await expect(late.getByText("This transfer is closed")).toBeVisible()
  await late.context().close()

  // The sender sees the download, and can revoke.
  await page.goto("/transfers")
  const item = page.getByRole("listitem").filter({ hasText: title }).first()
  await expect(item).toBeVisible()
  await expect(item).toContainText("1")
  await item.getByRole("button", { name: "Revoke", exact: true }).click()
  await item.getByRole("button", { name: "Revoke and delete copies" }).click()
  await expect(item).toContainText(/Revoked/i)

  await page.goto("/")
  await menu(page, folder, /trash/i)
})
