import { expect, test, type Page } from "@playwright/test"

import { PASSWORD, signIn } from "./helpers"

async function unlock(page: Page) {
  await page.goto("/secrets")
  await page.getByLabel("Your Nimbus password").fill(PASSWORD)
  await page.getByRole("button", { name: "Unlock", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Secrets", exact: true })).toBeVisible()
}

test("Connect your apps: opens from the top bar, anchors work, code copies, fits a phone", async ({ page }) => {
  await signIn(page)
  await unlock(page)
  await page.getByRole("link", { name: "Connect apps" }).click()
  await expect(page).toHaveURL(/\/secrets\/connect$/)
  await expect(page.getByRole("heading", { name: "Connect your apps", level: 1 })).toBeVisible()
  for (const h of ["Overview", "CLI", "Machine tokens", "REST API", "Webhooks", "Security notes"])
    await expect(page.getByRole("heading", { name: h, exact: true, level: 2 })).toBeVisible()

  // A table of contents link scrolls to its section.
  await page.getByRole("navigation", { name: "On this page" }).getByRole("link", { name: "Webhooks", exact: true }).click()
  await expect(page).toHaveURL(/#webhooks$/)
  await expect(page.locator("#webhooks")).toBeInViewport()

  // The guide uses this server's address, and a copy button copies the whole block.
  const block = page.locator("pre", { hasText: "X-Nimbus-Signature" }).or(page.locator("pre", { hasText: "createHmac" })).first()
  await block.scrollIntoViewIfNeeded()
  await block.locator("xpath=..").getByRole("button", { name: "Copy code" }).click()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied).toBe((await block.innerText()).trimEnd())
  await expect(page.locator("pre", { hasText: "nimbus.example.com" })).toHaveCount(0)

  // The old address still opens it, for `nimbus login` links.
  await page.goto("/secrets/cli?code=NOPE-0000")
  await expect(page.getByRole("heading", { name: "Connect your apps", level: 1 })).toBeVisible()
  await expect(page.getByText("That code isn't valid.")).toBeVisible()

  // On a phone nothing scrolls sideways, and the contents sit behind "On this page".
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/secrets/connect")
  await expect(page.getByRole("heading", { name: "Connect your apps", level: 1 })).toBeVisible()
  await page.getByText("On this page").click()
  await expect(page.getByRole("navigation", { name: "On this page" }).getByRole("link", { name: "Kubernetes" }).first()).toBeVisible()
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(wide).toBeLessThanOrEqual(0)
})
