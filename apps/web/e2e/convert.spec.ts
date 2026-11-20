import { expect, test, type Page } from "@playwright/test"

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { menu, newFolder, row, signIn } from "./helpers"

// Media Converter (/more/convert). The dev server and `npm run worker` must be running, with ffmpeg on the worker's PATH.
// Signs in as the dev admin (also a member). Fixtures: e2e/fixtures/convert-clip.mp4 (3 s, 640x360, with sound) and
// convert-image.png, made with ffmpeg's lavfi sources. HEIC to JPG runs only where heif-enc and heif-convert exist.
const EMAIL = process.env.E2E_ADMIN ?? "admin-test@example.invalid"
const PASS = process.env.E2E_ADMIN_PASSWORD ?? "admin-test-pass-123"
const sql = (q: string) => execFileSync("psql", [process.env.DATABASE_URL ?? "postgres://nimbus:nimbus@localhost:5432/nimbus", "-qAtc", q]).toString().trim()
const who = `(select id from "user" where email = '${EMAIL}')`
const tag = Date.now().toString(36)
const FIX = new URL("fixtures", import.meta.url).pathname
const BASE = "/more/convert"
const has = (bin: string) => {
  try {
    execFileSync("which", [bin])
    return true
  } catch {
    return false
  }
}

// Uploads a fixture into the folder on screen, under a new name, and waits for it.
async function uploadFixture(page: Page, file: string, name: string) {
  const chooser = page.waitForEvent("filechooser")
  await page.getByRole("button", { name: "New", exact: true }).click()
  await page.getByRole("menuitem", { name: "File upload" }).click()
  await (await chooser).setFiles({ name, mimeType: "application/octet-stream", buffer: readFileSync(join(FIX, file)) })
  await expect(row(page, name)).toBeVisible()
}

// The worker converts in the background: reload until the check passes.
const settle = (page: Page, check: () => Promise<void>, timeout = 120_000) =>
  expect(async () => {
    await page.reload()
    await check()
  }).toPass({ timeout, intervals: [2000] })

const dialog = (page: Page) => page.getByRole("dialog")
const choose = async (page: Page, preset: string) => {
  await dialog(page).getByRole("radio", { name: new RegExp(`^${preset}(?! 1600)`) }).check()
  await dialog(page).getByRole("button", { name: "Convert", exact: true }).click()
}

test.describe.configure({ mode: "serial" })

test.afterAll(() => {
  sql(`update settings set convert_daily_minutes = 0, convert_tool_enabled = true`)
  sql(`delete from convert_jobs where user_id = ${who} and input_name like 'e2e ${tag}%'`)
})

test("media converter: video, GIF, image, preset, watch folder and quota", async ({ page }) => {
  test.setTimeout(480_000)
  const clip = `e2e ${tag} clip.mp4`
  const pic = `e2e ${tag} pic.png`

  await test.step("start clean and upload the fixtures", async () => {
    sql(`update settings set convert_daily_minutes = 0, convert_tool_enabled = true, convert_max_bytes = null, convert_max_seconds = null`)
    sql(`delete from convert_watches where user_id = ${who}; delete from convert_presets where user_id = ${who}`)
    await signIn(page, EMAIL, PASS)
    await page.goto("/")
    await uploadFixture(page, "convert-clip.mp4", clip)
    await uploadFixture(page, "convert-image.png", pic)
  })

  await test.step("empty queue, built-in presets", async () => {
    sql(`delete from convert_jobs where user_id = ${who}`)
    await page.goto(BASE)
    await expect(page.getByRole("heading", { name: "Media converter", level: 1 })).toBeVisible()
    await expect(page.getByText("Nothing converting")).toBeVisible()
    await expect(page.getByRole("heading", { name: "Presets" })).toBeVisible()
    await expect(page.getByText("Smaller (H.265)")).toBeVisible()
    await expect(page.getByText("No watched folders")).toBeVisible()
  })

  await test.step("an mp4 to 480p from the file menu", async () => {
    await page.goto("/")
    await menu(page, clip, "Convert…")
    await expect(dialog(page).getByRole("heading", { name: `Convert “${clip}”` })).toBeVisible()
    await expect(dialog(page).getByRole("radio", { name: /^480p/ })).toBeVisible()
    await expect(dialog(page).getByRole("radio", { name: /^PNG|^WebP/ })).toHaveCount(0) // video: no image presets
    await expect(dialog(page).getByRole("group", { name: /Trim/ })).toHaveCount(0) // until a video preset is picked
    await dialog(page).getByRole("radio", { name: /^480p/ }).check()
    await expect(dialog(page).getByRole("group", { name: /Trim/ })).toBeVisible()
    await dialog(page).getByRole("button", { name: "Convert", exact: true }).click()
    await expect(page.getByText(/Converting “.*” with 480p/)).toBeVisible()
    await page.goto(BASE)
    await settle(page, () => expect(page.getByText(`Saved as e2e ${tag} clip (480p).mp4`)).toBeVisible())
    const [size, mime] = sql(`select size, mime from nodes where owner_id = ${who} and name = 'e2e ${tag} clip (480p).mp4' and trashed_at is null`).split("|")
    expect(Number(size)).toBeGreaterThan(1000)
    expect(mime).toBe("video/mp4")
    // The original is still there.
    expect(sql(`select count(*) from nodes where owner_id = ${who} and name = '${clip}' and trashed_at is null`)).toBe("1")
  })

  await test.step("the same mp4 to a GIF, from the tool page picker", async () => {
    await page.goto(BASE)
    await page.getByRole("button", { name: "Convert files" }).first().click()
    await dialog(page).getByLabel("Search your files").fill(`${tag} clip.mp4`)
    await dialog(page).getByRole("checkbox").first().check()
    await dialog(page).getByRole("button", { name: "Next", exact: true }).click()
    await choose(page, "GIF")
    await settle(page, () => expect(page.getByText(`Saved as e2e ${tag} clip (GIF).gif`)).toBeVisible())
    expect(sql(`select mime from nodes where owner_id = ${who} and name = 'e2e ${tag} clip (GIF).gif'`)).toBe("image/gif")
  })

  await test.step("an image to WebP", async () => {
    await page.goto("/")
    await menu(page, pic, "Convert…")
    await expect(dialog(page).getByRole("radio", { name: /^WebP/ })).toBeVisible()
    await expect(dialog(page).getByRole("radio", { name: /^480p/ })).toHaveCount(0) // image: no video presets
    await choose(page, "WebP")
    await page.goto(BASE)
    await settle(page, () => expect(page.getByText(`Saved as e2e ${tag} pic (WebP).webp`)).toBeVisible())
    expect(sql(`select mime from nodes where owner_id = ${who} and name = 'e2e ${tag} pic (WebP).webp'`)).toBe("image/webp")
  })

  await test.step("a preset of your own, and the empty-search state of the picker", async () => {
    await page.goto(BASE)
    await page.getByRole("button", { name: "New preset" }).click()
    await dialog(page).getByLabel("Name").fill(`Tiny ${tag}`)
    await dialog(page).getByLabel("Makes a").selectOption("audio")
    await dialog(page).getByLabel("Bitrate").selectOption("64")
    await dialog(page).getByRole("button", { name: "Save preset" }).click()
    await expect(page.getByRole("heading", { name: "Yours" })).toBeVisible()
    await expect(page.getByText(`Tiny ${tag}`)).toBeVisible()
    await page.getByRole("button", { name: "Convert files" }).first().click()
    await dialog(page).getByLabel("Search your files").fill("zzz-no-such-file")
    await expect(dialog(page).getByText("No video, audio or image file has that name.")).toBeVisible()
    await dialog(page).getByRole("button", { name: "Cancel" }).click()
    await page.getByRole("button", { name: `Delete Tiny ${tag}` }).click()
    await page.getByRole("button", { name: "Delete", exact: true }).click()
    await expect(page.getByText(`Tiny ${tag}`)).toHaveCount(0)
  })

  const folder = `e2e ${tag} watched`
  await test.step("a watch folder converts what lands in it, once", async () => {
    await page.goto("/")
    await newFolder(page, folder)
    const folderId = sql(`select id from nodes where owner_id = ${who} and name = '${folder}'`)
    await page.goto(BASE)
    await page.getByRole("button", { name: "Watch a folder" }).click()
    await page.getByRole("button", { name: "Choose a folder" }).click()
    await dialog(page).getByRole("button", { name: folder }).click()
    await dialog(page).getByRole("button", { name: "Watch this folder" }).click()
    await page.getByLabel("Convert with").selectOption({ label: "WebP" })
    await page.getByRole("button", { name: "Watch", exact: true }).click()
    await expect(page.getByText(`/${folder}`)).toBeVisible()

    await page.goto(`/folders/${folderId}`)
    const dropped = `e2e ${tag} dropped.png`
    await uploadFixture(page, "convert-image.png", dropped)
    await page.goto(BASE)
    await settle(page, () => expect(page.getByText(`Saved as e2e ${tag} dropped (WebP).webp`)).toBeVisible())
    // The output sits in the watched folder too; it must not be converted again.
    await page.waitForTimeout(8000)
    expect(sql(`select count(*) from convert_jobs where user_id = ${who} and input_name like 'e2e ${tag} dropped%'`)).toBe("1")
    expect(sql(`select count(*) from nodes where owner_id = ${who} and parent_id = '${folderId}' and trashed_at is null`)).toBe("2")

    await page.getByRole("button", { name: /^Stop watching/ }).click()
    await expect(page.getByText("No watched folders")).toBeVisible()
  })

  await test.step("refused once the daily quota is used", async () => {
    sql(`update settings set convert_daily_minutes = 1`)
    sql(`insert into convert_jobs (user_id, status, input_name, preset_name, preset, seconds, finished_at)
         values (${who}, 'done', 'e2e ${tag} seeded', '480p', '{"kind":"video","codec":"h264","container":"mp4","height":480}', 120, now())`)
    await page.goto(BASE)
    await expect(page.getByText("1 of 1 min today")).toBeVisible()
    await page.goto("/")
    await menu(page, clip, "Convert…")
    await expect(dialog(page).getByText("1 of 1 minutes used today.")).toBeVisible()
    await choose(page, "720p")
    await expect(dialog(page).getByRole("alert")).toContainText("You've used your 1 minutes of conversion for today")
    expect(sql(`select count(*) from convert_jobs where user_id = ${who} and preset_name = '720p'`)).toBe("0")
    sql(`update settings set convert_daily_minutes = 0`)
  })

  await test.step("turned off: the page is gone", async () => {
    sql(`update settings set convert_tool_enabled = false`)
    const r = await page.goto(BASE)
    expect(r?.status()).toBe(404)
    sql(`update settings set convert_tool_enabled = true`)
  })
})

test("HEIC photo to JPG", async ({ page }) => {
  test.skip(!has("heif-enc") || !has("heif-convert"), "needs heif-enc (to make the fixture) and heif-convert (libheif-examples)")
  test.setTimeout(180_000)
  const heic = `e2e ${tag} photo.heic`
  execFileSync("heif-enc", [join(FIX, "convert-image.png"), "-o", join(FIX, "convert-photo.heic")])
  await signIn(page, EMAIL, PASS)
  await page.goto("/")
  await uploadFixture(page, "convert-photo.heic", heic)
  await menu(page, heic, "Convert…")
  await choose(page, "JPG")
  await page.goto(BASE)
  await settle(page, () => expect(page.getByText(`Saved as e2e ${tag} photo (JPG).jpg`)).toBeVisible())
})
