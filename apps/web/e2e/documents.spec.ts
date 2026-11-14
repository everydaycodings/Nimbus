import { expect, test, type Page } from "@playwright/test"
import { Queue } from "bullmq"
import IORedis from "ioredis"
import { PDFDocument, StandardFonts } from "pdf-lib"

import { row, signIn, unique } from "./helpers"

// Needs the worker running: it reads the PDFs and files them as documents.

async function bill(lines: string[]) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const page = pdf.addPage([595, 842])
  lines.forEach((l, i) =>
    page.drawText(l, { x: 50, y: 780 - i * 22, size: 14, font })
  )
  return Buffer.from(await pdf.save())
}

const tomorrow = () =>
  new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)

// The list reloads until the worker has filed the file.
async function filed(page: Page, name: string) {
  await expect(async () => {
    await page.reload()
    await expect(row(page, name)).toBeVisible({ timeout: 2_500 })
  }).toPass({ timeout: 170_000, intervals: [3_000] })
}

test.describe.configure({ mode: "serial" })

const id = unique("bill").replace(/\W+/g, "-")
const A = `${id}-a.pdf`
const B = `${id}-b.pdf`
let mergedIds: string[] = []

test("upload, review, confirm, filter, search, merge, zip, dismiss and undo", async ({
  page,
}) => {
  test.setTimeout(300_000)
  await signIn(page)
  await page.goto("/documents?tab=review")
  await expect(
    page.getByRole("heading", { name: "Documents", level: 1 })
  ).toBeVisible()

  // Upload into Documents/<year>.
  const up = (name: string, lines: string[]) =>
    bill(lines).then((buffer) => ({
      name,
      mimeType: "application/pdf",
      buffer,
    }))
  await page
    .getByTestId("documents-upload")
    .setInputFiles([
      await up(A, [
        "ZORBEX POWER LTD",
        "Invoice No 4711",
        "Invoice date: 2025-03-14",
        "Total due: $123.45",
        `Payment due: ${tomorrow()}`,
      ]),
      await up(B, [
        "ZORBEX POWER LTD",
        "Invoice No 4712",
        "Invoice date: 2025-04-14",
        "Total due: $77.00",
      ]),
    ])
  await expect(page.getByText(/Added to Documents\//)).toBeVisible({
    timeout: 60_000,
  })

  // The worker files them as "Needs review".
  await filed(page, A)
  await filed(page, B)
  await page.getByRole("searchbox", { name: "Search documents" }).fill(id)
  await expect(row(page, A)).toContainText("Needs review")

  // Review: the panel shows the guesses; confirm.
  await row(page, A).click()
  const panel = page.getByRole("complementary", { name: "Document" })
  await expect(panel.getByLabel("Sender")).toHaveValue(/zorbex/i)
  await expect(panel.getByLabel("Amount")).toHaveValue("123.45")
  await expect(panel.getByText("Guessed from the text").first()).toBeVisible()
  await panel.getByLabel("Notes").fill("paid by card")
  await panel.getByRole("button", { name: "Confirm" }).click()
  await expect(
    panel.getByText("Confirmed", { exact: true }).first()
  ).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(panel).toBeHidden()

  // Filters: by type and amount.
  await page.goto(`/documents?q=${id}`)
  await expect(row(page, A)).toBeVisible()
  await page.getByRole("button", { name: "Filters" }).click()
  await page.getByLabel("Amount from").fill("100")
  await expect(row(page, A)).toBeVisible()
  await expect(row(page, B)).toBeHidden()
  await page.getByLabel("Amount from").fill("500")
  await expect(row(page, A)).toBeHidden()
  await page.getByRole("button", { name: "Clear", exact: true }).click()
  await expect(row(page, A)).toBeVisible()

  // Needs review keeps only B; the count is in the tab.
  await page.getByRole("link", { name: /^Needs review/ }).click()
  await expect(page).toHaveURL(/tab=review/)

  // Search words.
  await page.goto(
    `/search?q=${encodeURIComponent(`${id} type:invoice sender:zorbex amount>100 year:2025`)}`
  )
  await expect(row(page, A)).toBeVisible()
  await expect(row(page, B)).toBeHidden()
  await page.goto(`/search?q=${encodeURIComponent(`${id} amount>9999`)}`)
  await expect(row(page, A)).toBeHidden()

  // Totals.
  await page.goto("/documents?tab=totals")
  await expect(page.getByText(/Zorbex/i).first()).toBeVisible()
  await page.getByRole("button", { name: "By type" }).click()
  await expect(page.getByText("Invoice", { exact: true }).first()).toBeVisible()

  // Bulk: merge, then zip.
  await page.goto(`/documents?q=${id}`)
  await row(page, A).getByRole("checkbox").click()
  await row(page, B).getByRole("checkbox").click()
  const bar = page.getByRole("toolbar", { name: "Selected documents" })
  await expect(bar).toContainText("2 selected")
  const merged = async () =>
    (
      (await (
        await page.request.get(
          "/api/v1/documents?sort=added&order=desc&limit=10"
        )
      ).json()) as {
        items: { id: string; name: string }[]
      }
    ).items.filter((i) => i.name.startsWith("Merged "))
  const before = new Set((await merged()).map((i) => i.id))
  await bar.getByRole("button", { name: "Merge into PDF" }).click()
  await expect(page.getByText("Merged into one PDF")).toBeVisible({
    timeout: 30_000,
  })
  mergedIds = (await merged()).map((i) => i.id).filter((i) => !before.has(i))
  expect(mergedIds).toHaveLength(1)
  await row(page, A).getByRole("checkbox").click()
  const dl = page.waitForEvent("download")
  await row(page, B).getByRole("checkbox").click()
  await bar.getByRole("button", { name: "Download" }).click()
  expect((await dl).suggestedFilename()).toMatch(/\.zip$/)

  // Dismiss and undo.
  await page.goto(`/documents?q=${id}`)
  await row(page, B).getByRole("checkbox").click()
  await bar.getByRole("button", { name: "Not a document" }).click()
  await expect(row(page, B)).toBeHidden()
  await page.getByRole("button", { name: "Undo" }).click()
  await expect(row(page, B)).toBeVisible()
})

test("an expiring document reaches the bell", async ({ page }) => {
  await signIn(page)
  await page.goto(`/documents?q=${id}`)
  await row(page, A).click()
  const panel = page.getByRole("complementary", { name: "Document" })
  await panel.getByLabel("Expires or due").fill(tomorrow())
  await panel.getByLabel("Remind me before").fill("5")
  await panel.getByRole("button", { name: "Save" }).click()
  await expect(page.getByText("Saved.")).toBeVisible()

  // Run the daily job now, through the worker's queue.
  const redis = new IORedis(
    process.env.REDIS_URL ?? "redis://localhost:6380/0",
    { maxRetriesPerRequest: null }
  )
  const jobs = new Queue("jobs", { connection: redis })
  await jobs.add("documents-remind", {}, { removeOnComplete: true })
  await jobs.close()
  redis.disconnect()

  await page.goto("/")
  await expect(async () => {
    await page.reload()
    await page.getByRole("button", { name: /^Notifications/ }).click()
    await expect(
      page
        .getByText(new RegExp(`${A}” expires in 1 days|${A}” expires today`))
        .first()
    ).toBeVisible({ timeout: 2_500 })
  }).toPass({ timeout: 60_000, intervals: [2_000] })

  // Clean up: the test's files go to the trash.
  const mine = (await (
    await page.request.get(`/api/v1/documents?q=${id}`)
  ).json()) as { items: { id: string }[] }
  const ids = [...mine.items.map((i) => i.id), ...mergedIds]
  expect(
    (await page.request.post("/api/v1/items/trash", { data: { ids } })).ok()
  ).toBe(true)
})

test("an admin can turn Documents off and on", async ({ page }) => {
  await signIn(
    page,
    process.env.E2E_ADMIN ?? "admin-test@example.invalid",
    process.env.E2E_ADMIN_PASSWORD ?? "admin-test-pass-123"
  )
  const box = () => page.getByRole("checkbox", { name: "Turn on Documents" })
  const save = () => page.getByRole("button", { name: "Save" }).first().click()
  await page.goto("/admin/system/documents")
  await expect(box()).toBeChecked()
  await box().uncheck()
  await save()
  // The change lands a moment after the click.
  await expect(async () => {
    await page.goto("/")
    await expect(page.getByRole("link", { name: "Photos" })).toBeVisible()
    await expect(
      page.getByRole("link", { name: "Documents", exact: true })
    ).toBeHidden({ timeout: 1_000 })
  }).toPass({ timeout: 20_000 })
  expect((await page.request.get("/api/v1/documents")).status()).toBe(404)
  await page.goto("/admin/audit")
  await expect(
    page.getByText(/documentsEnabled: true → false/).first()
  ).toBeVisible()

  await page.goto("/admin/system/documents")
  await box().check()
  await save()
  await expect(async () => {
    await page.goto("/")
    await expect(
      page.getByRole("link", { name: "Documents", exact: true })
    ).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 20_000 })
  expect((await page.request.get("/api/v1/documents")).status()).toBe(200)
})
