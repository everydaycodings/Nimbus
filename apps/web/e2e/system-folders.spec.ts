import { expect, test } from "@playwright/test"

import { OTHER, row, signIn } from "./helpers"

const SHOTS = process.env.SHOTS ?? "/tmp"

test("system folders: icon, label, order, warnings", async ({ page }) => {
  await signIn(page, OTHER)
  const camera = row(page, "Camera")
  await expect(camera).toContainText("Auto · Photo backup")
  // Pinned first among the folders.
  await expect(page.getByRole("option").first()).toContainText("Auto ·")
  await page.screenshot({ path: `${SHOTS}/grid.png` })
  await page.getByRole("button", { name: /list/i }).first().click().catch(() => {})
  await page.screenshot({ path: `${SHOTS}/list.png` })

  // Rename warns, Cancel leaves it alone.
  await camera.click({ button: "right" })
  await page.getByRole("menuitem", { name: "Rename" }).click()
  const dlg = page.getByRole("dialog")
  await expect(dlg).toContainText("next backup makes a new Camera folder")
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${SHOTS}/warn-rename.png` })
  await dlg.getByRole("button", { name: "Cancel" }).click()

  await camera.click({ button: "right" })
  await page.getByRole("menuitem", { name: "Move", exact: true }).click()
  await expect(page.getByRole("dialog")).toContainText("move it")
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click()

  await camera.click({ button: "right" })
  await page.getByRole("menuitem", { name: /Move to trash/ }).click()
  await expect(page.getByRole("dialog")).toContainText("delete it")
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click()

  await camera.dblclick()
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Auto · Photo backup")
  await page.screenshot({ path: `${SHOTS}/header.png` })
})
