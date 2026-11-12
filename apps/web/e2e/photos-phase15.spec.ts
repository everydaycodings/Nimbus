import { expect, test, type Page } from "@playwright/test"
import sharp from "sharp"

import { readExif, withExif } from "@nimbus/shared/exif-write"

import { OTHER, menu, newFolder, row, signIn, unique } from "./helpers"

// Phase 15 (Photos) needs the worker running: it reads each photo's date and GPS and sorts
// screenshots, so those checks reload until it has caught up.

const PARIS = { lat: 48.8584, lng: 2.2945 }
// Today's month and day, seven years back (noon UTC, so the day is the same in any time zone).
const memoryDay = (() => {
  const n = new Date()
  return new Date(Date.UTC(n.getFullYear() - 7, n.getMonth(), n.getDate(), 12))
})()

async function jpeg(takenAt: Date, gps = PARIS) {
  const plain = await sharp({
    create: { width: 120, height: 90, channels: 3, background: { r: 40, g: 120, b: 200 } },
  })
    .jpeg()
    .toBuffer()
  return Buffer.from(withExif(plain, { takenAt, gps }))
}

async function uploadFile(page: Page, name: string, mimeType: string, buffer: Buffer) {
  const chooser = page.waitForEvent("filechooser")
  await page.getByRole("button", { name: "New", exact: true }).click()
  await page.getByRole("menuitem", { name: "File upload" }).click()
  await (await chooser).setFiles({ name, mimeType, buffer })
  await expect(row(page, name)).toBeVisible()
}

// Reloads until the worker has done its part.
const eventually = (page: Page, check: () => Promise<void>) =>
  expect(async () => {
    await page.reload()
    await check()
  }).toPass({ timeout: 120_000, intervals: [3_000] })

const id = Date.now().toString(36)
const names = { a: `e2e-${id}-a.jpg`, b: `e2e-${id}-b.jpg`, shot: `Screenshot e2e-${id}.png` }
let folder = ""
let folderUrl = ""

test.describe.serial("Photos (phase 15)", () => {
  test("seed photos with a date and a location", async ({ page }) => {
    await signIn(page)
    folder = unique("photos")
    await newFolder(page, folder)
    await row(page, folder).dblclick()
    await page.waitForURL(/\/folders\//)
    folderUrl = page.url()
    await uploadFile(page, names.a, "image/jpeg", await jpeg(memoryDay))
    await uploadFile(page, names.b, "image/jpeg", await jpeg(new Date(memoryDay.getTime() + 3_600_000)))
    const shot = await sharp({
      create: { width: 90, height: 160, channels: 3, background: { r: 230, g: 230, b: 230 } },
    })
      .png()
      .toBuffer()
    await uploadFile(page, names.shot, "image/png", shot)
  })

  test("On this day: a card, hide and undo, the slideshow, and a smart chip", async ({ page }) => {
    await signIn(page)
    await page.goto("/photos")
    const strip = page.getByRole("region", { name: "On this day" })
    await eventually(page, () => expect(strip.getByText("7 years ago").first()).toBeVisible({ timeout: 2_000 }))

    // Hide the year's cover photo, then take it back with Undo.
    const hide = strip.getByRole("button", { name: "Hide from memories" }).first()
    await hide.click()
    await page.getByRole("menuitem", { name: "Hide this photo" }).click()
    await expect(page.getByText("Hidden from memories.")).toBeVisible()
    await page.getByRole("button", { name: "Undo" }).click()
    await expect(strip.getByText("7 years ago").first()).toBeVisible()

    // The memories slideshow opens with a title card; arrows move on, Esc closes it.
    await strip.getByRole("button", { name: "Play all" }).click()
    const show = page.getByRole("dialog", { name: "Slideshow" })
    await expect(show.getByText("7 years ago").first()).toBeVisible()
    await page.keyboard.press("ArrowRight")
    await expect(show.getByText(/2 \//)).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(show).toBeHidden()

    // Screenshots chip: the worker files the PNG there by its name.
    await page.getByRole("navigation", { name: "Photo groups" }).getByRole("link", { name: "Screenshots" }).click()
    await expect(page).toHaveURL(/\/photos\/smart\/screenshots/)
    await eventually(page, () => expect(page.getByRole("button", { name: names.shot })).toBeVisible({ timeout: 2_000 }))
  })

  test("an album shared with a second account, and a public link", async ({ page, browser }) => {
    await signIn(page)
    await page.goto("/photos/albums")
    const album = unique("album")
    await page.getByRole("button", { name: "New album" }).click()
    await page.getByRole("dialog").getByRole("textbox").fill(album)
    await page.getByRole("dialog").getByRole("button", { name: "Create" }).click()
    await page.waitForURL(/\/photos\/albums\/[0-9a-f-]{36}/)
    await expect(page.getByRole("heading", { name: album })).toBeVisible()

    await page.getByRole("button", { name: "Add photos" }).click()
    const picker = page.getByRole("dialog", { name: "Add photos" })
    await picker.getByRole("button", { name: names.a }).click()
    await picker.getByRole("button", { name: "Add 1" }).click()
    await expect(page.getByRole("button", { name: names.a, exact: true })).toBeVisible()

    // People (viewer) and a link.
    await page.getByRole("button", { name: "Share", exact: true }).click()
    const share = page.getByRole("dialog", { name: /Share/ })
    await share.getByRole("combobox", { name: "Add people" }).fill(OTHER)
    await share.getByRole("option").filter({ hasText: OTHER }).click()
    await share.getByRole("button", { name: "Share", exact: true }).click()
    await expect(share.getByText(OTHER)).toBeVisible()
    await share.getByRole("button", { name: "New link" }).click()
    await share.getByRole("button", { name: "Copy", exact: true }).click()
    const url = await page.evaluate(() => navigator.clipboard.readText())
    expect(url).toContain("/a/")
    await page.keyboard.press("Escape")

    // The second account finds it in Albums and opens the photo (as a viewer: no Add photos).
    const them = await (await browser.newContext()).newPage()
    await signIn(them, OTHER)
    await them.goto("/photos/albums")
    await them.getByRole("link", { name: new RegExp(album) }).click()
    await expect(them.getByRole("button", { name: "Add photos" })).toBeHidden()
    await them.getByRole("button", { name: names.a, exact: true }).click()
    await expect(them.locator("[data-preview]")).toBeVisible()
    await them.context().close()

    // Signed out: the public page shows the photo without any account.
    const guest = await (await browser.newContext()).newPage()
    await guest.goto(url)
    await expect(guest.getByRole("button", { name: `Open ${names.a}` })).toBeVisible()
    await guest.context().close()

    // Deleting the album keeps the photo.
    await page.getByRole("button", { name: "Album actions" }).click()
    await page.getByRole("menuitem", { name: "Delete album" }).click()
    await page.getByRole("dialog").getByRole("button", { name: "Delete album" }).click()
    await page.waitForURL(/\/photos\/albums$/)
    await page.goto("/photos")
    await expect(page.getByRole("button", { name: names.a, exact: true })).toBeVisible()
  })

  test("partner photos merge into the other timeline, with a badge and a switch", async ({ page, browser }) => {
    await signIn(page)
    await page.goto("/account")
    // A clean start, in case an earlier run stopped halfway.
    const stop = page.getByRole("button", { name: "Stop sharing" })
    if (await stop.isVisible()) await stop.click()
    const partner = page.locator("#partner")
    await partner.getByRole("combobox", { name: "Invite a partner" }).fill(OTHER)
    await partner.getByRole("option").filter({ hasText: OTHER }).click()
    await partner.getByRole("button", { name: "Invite" }).click()
    await expect(partner.getByText("waiting for them to accept")).toBeVisible()

    const them = await (await browser.newContext()).newPage()
    await signIn(them, OTHER)
    await them.goto("/account#partner")
    await them.locator("#partner").getByRole("button", { name: "Accept", exact: true }).click()
    await them.goto("/photos")
    const badge = them.getByTitle(/^From /).first()
    await expect(badge).toBeVisible()

    // The switch hides them, and shows them again.
    const toggle = them.getByRole("switch", { name: "Show partner photos" })
    await toggle.uncheck()
    await expect(them.getByTitle(/^From /)).toHaveCount(0)
    await toggle.check()
    await expect(badge).toBeVisible()
    await them.context().close()

    await page.reload()
    await page.getByRole("button", { name: "Stop sharing" }).click()
    await expect(partner.getByRole("combobox", { name: "Invite a partner" })).toBeVisible()
  })

  test("Places: the map draws a cluster that opens its photos", async ({ page }) => {
    // The default style comes from a third party; a blank one keeps the test offline.
    await page.route(/tiles\.openfreemap\.org/, (route) =>
      route.fulfill({
        json: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#dde" } }] },
      })
    )
    await signIn(page)
    await page.goto("/photos/places")
    // Two photos in one spot make a cluster marker (a count above 1).
    const cluster = page.locator('[data-cluster]:not([data-cluster="1"])').first()
    await eventually(page, () => expect(cluster).toBeVisible({ timeout: 5_000 }))
    await cluster.click()
    const sheet = page.getByRole("complementary", { name: "Photos here" })
    await expect(sheet.getByRole("button", { name: names.a })).toBeVisible()
    await sheet.getByRole("button", { name: names.a }).click()
    await expect(page.locator("[data-preview]")).toBeVisible()
  })

  test("quick edit: rotate a photo, save a new version that keeps its date and place", async ({ page }) => {
    await signIn(page)
    await page.goto(folderUrl)
    await row(page, names.b).dblclick()
    await page.getByRole("button", { name: "Edit photo" }).click()
    await page.getByRole("button", { name: "Rotate right" }).click()
    await page.getByRole("button", { name: "Save", exact: true }).click()
    await expect(page.getByRole("button", { name: "Close editor" })).toBeHidden({ timeout: 30_000 })
    // The current version is the edited one: turned on its side, same EXIF date and GPS.
    await expect(async () => {
      const download = page.waitForEvent("download")
      await page.getByRole("button", { name: "Download" }).click()
      const file = await (await download).path()
      const bytes = new Uint8Array(await (await import("node:fs/promises")).readFile(file))
      const meta = await sharp(bytes).metadata()
      expect([meta.width, meta.height]).toEqual([90, 120])
      const exif = readExif(bytes)
      expect(exif.takenAt?.toISOString()).toBe(new Date(memoryDay.getTime() + 3_600_000).toISOString())
      expect(exif.gps?.lat).toBeCloseTo(PARIS.lat, 4)
      expect(exif.gps?.lng).toBeCloseTo(PARIS.lng, 4)
    }).toPass({ timeout: 30_000, intervals: [2_000] })
  })

  test.afterAll(async ({ browser }) => {
    const page = await (await browser.newContext()).newPage()
    await signIn(page)
    await page.goto("/")
    if (folder) await menu(page, folder, /trash/i)
    await page.context().close()
  })
})
