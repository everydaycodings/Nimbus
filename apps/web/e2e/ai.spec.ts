import { expect, test } from "@playwright/test"

import { signIn } from "./helpers"

// Phase 20 smoke: People pages and the AI search filters. Skips when the
// instance has no AI features on for this member (nimbus-ml is optional).
test("people and AI search filters", async ({ page }) => {
  await signIn(page)
  const me = await (await page.request.get("/api/v1/me")).json()
  test.skip(!me.ai?.faces && !me.ai?.speech && !me.ai?.picture, "AI features are off")

  if (me.ai.faces) {
    await page.goto("/photos")
    await expect(page.getByRole("button", { name: "People" }).or(page.getByRole("link", { name: "People" })).first()).toBeVisible()
    await page.goto("/photos/people")
    await expect(page.getByRole("heading", { name: "People", level: 1 })).toBeVisible()
  }

  await page.goto("/search?q=test")
  await page.getByRole("button", { name: /Found in/ }).click()
  if (me.ai.speech) await expect(page.getByRole("menuitemcheckbox", { name: /Spoken/ }).or(page.getByText("Spoken")).first()).toBeVisible()
  if (me.ai.picture) await expect(page.getByRole("menuitemcheckbox", { name: /Picture/ }).or(page.getByText("Picture")).first()).toBeVisible()
})
