import { expect, test } from "@playwright/test"

import { OTHER, menu, newFolder, row, signIn, unique, upload } from "./helpers"

test("comment with a mention, reply live, react, resolve, find it in search", async ({
  page,
  browser,
}) => {
  await signIn(page)
  const folder = unique("comments")
  await newFolder(page, folder)
  await row(page, folder).dblclick()
  await page.waitForURL(/\/folders\//)
  const folderUrl = page.url()
  await upload(page, "plan.txt", "the plan")

  await menu(page, "plan.txt", "Share…")
  const share = page.getByRole("dialog")
  await share.getByRole("combobox", { name: "Add people" }).fill(OTHER)
  await share.getByRole("option").filter({ hasText: OTHER }).click()
  await share.getByRole("button", { name: "Share", exact: true }).click()
  await expect(share.getByText(OTHER)).toBeVisible()
  await page.keyboard.press("Escape")

  // A thread from the previewer, mentioning the viewer it's shared with.
  await row(page, "plan.txt").dblclick()
  await page.getByRole("button", { name: "Comments" }).click()
  const panel = page.getByRole("complementary", { name: "Comments" })
  const box = panel.getByRole("textbox", { name: /Add a comment/ })
  const word = `zebra${Date.now().toString(36)}`
  await box.fill(`Can you check this ${word} `)
  await box.pressSequentially("@New")
  await panel.getByRole("option", { name: /New Bie/ }).click()
  await box.press("ControlOrMeta+Enter")
  await expect(panel.getByText(word)).toBeVisible()
  await expect(panel.getByText("@New Bie")).toBeVisible()
  await expect(box).toHaveValue("")

  // The viewer gets a mention in the bell, opens it, and replies; the owner sees it without reloading.
  const them = await (await browser.newContext()).newPage()
  await signIn(them, OTHER)
  await them.getByRole("button", { name: /Notifications/ }).click()
  await them.getByText(/mentioned you on “plan.txt”/).first().click()
  const theirs = them.getByRole("complementary", { name: "Comments" })
  await expect(theirs.getByText(word)).toBeVisible()
  await theirs.getByRole("button", { name: "Reply" }).click()
  const reply = theirs.getByRole("textbox", { name: "Reply" })
  await reply.fill("Looks good to me")
  await theirs.getByRole("button", { name: "Send" }).first().click()
  await expect(panel.getByText("Looks good to me")).toBeVisible()

  // A reaction from the owner reaches the viewer too.
  await panel.getByRole("button", { name: "Add a reaction" }).first().click()
  await page.getByRole("menuitem", { name: "React 👍" }).click()
  await expect(theirs.getByRole("button", { name: /👍 1/ })).toBeVisible()
  await them.context().close()

  // Search finds the comment text.
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: /Search/ }).first().click()
  await page.keyboard.type(word)
  await expect(page.getByText(/In a comment:/).first()).toBeVisible()
  await page.keyboard.press("Escape")

  // The row shows one open thread; resolving it clears that.
  await page.goto(folderUrl)
  await expect(row(page, "plan.txt").getByTitle("1 open comment thread")).toBeVisible()
  await row(page, "plan.txt").dblclick()
  await page.getByRole("button", { name: /Comments/ }).click()
  await panel.getByRole("button", { name: "Actions for your comment" }).click()
  await page.getByRole("menuitem", { name: "Resolve" }).click()
  await expect(panel.getByText("Every thread is resolved.")).toBeVisible()
  await panel.getByRole("button", { name: "Show 1 resolved" }).click()
  await expect(panel.getByText(/Resolved by/)).toBeVisible()
  await page.keyboard.press("Escape")

  await page.goto("/")
  await menu(page, folder, /trash/i)
})

test("a comment points at a video's time and a PDF page, and its chip jumps there", async ({
  page,
}) => {
  await signIn(page)
  const folder = unique("anchors")
  await newFolder(page, folder)
  await row(page, folder).dblclick()
  await page.waitForURL(/\/folders\//)
  for (const name of ["clip.webm", "pages.pdf"]) {
    const chooser = page.waitForEvent("filechooser")
    await page.getByRole("button", { name: "New", exact: true }).click()
    await page.getByRole("menuitem", { name: "File upload" }).click()
    await (await chooser).setFiles(new URL(`fixtures/${name}`, import.meta.url).pathname)
    await expect(row(page, name)).toBeVisible()
  }
  const panel = page.getByRole("complementary", { name: "Comments" })
  const box = panel.getByRole("textbox", { name: /Add a comment/ })

  // The video at 3 s: the composer offers "At 0:03", and the chip seeks back there.
  await row(page, "clip.webm").dblclick()
  const video = page.locator("[data-preview] video")
  await expect(video).toBeVisible()
  await video.evaluate(async (v: HTMLVideoElement) => {
    if (v.readyState < 1) await new Promise((r) => v.addEventListener("loadedmetadata", r, { once: true }))
    v.pause()
    v.currentTime = 3
  })
  await page.getByRole("button", { name: "Comments" }).click()
  await box.click()
  await panel.getByRole("checkbox").check()
  await expect(panel.getByText("At 0:03")).toBeVisible()
  await box.fill("Look at this frame")
  await box.press("ControlOrMeta+Enter")
  await expect(panel.getByText("Look at this frame")).toBeVisible()
  await video.evaluate((v: HTMLVideoElement) => {
    v.pause()
    v.currentTime = 0
  })
  await panel.getByRole("button", { name: "Jump to 0:03" }).click()
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => Math.floor(v.currentTime)))
    .toBeGreaterThanOrEqual(3)
  await page.keyboard.press("Escape")

  // Page 2 of the PDF: the chip points the viewer there.
  await row(page, "pages.pdf").dblclick()
  await expect(page.locator("[data-preview] iframe[data-pdf]")).toBeVisible()
  // The panel stays open from one file to the next.
  await box.click()
  await panel.getByLabel("Page number").fill("2")
  await box.fill("Typo on this page")
  await box.press("ControlOrMeta+Enter")
  await expect(panel.getByText("Typo on this page")).toBeVisible()
  await panel.getByRole("button", { name: "Go to page 2" }).click()
  await expect(page.locator("[data-preview] iframe[data-pdf]")).toHaveAttribute("src", /#.*page=2/)
  await page.keyboard.press("Escape")

  await page.goto("/")
  await menu(page, folder, /trash/i)
})
