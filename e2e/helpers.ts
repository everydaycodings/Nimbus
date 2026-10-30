import { expect, type Page } from "@playwright/test"

export const PASSWORD = process.env.E2E_PASSWORD ?? "browser-test-pass-123"
export const ME = process.env.E2E_EMAIL ?? "browser-test@example.invalid"
export const OTHER = process.env.E2E_EMAIL2 ?? "newbie@example.invalid"

// Names no earlier run left behind.
export const unique = (base: string) => `e2e ${Date.now().toString(36)} ${base}`

export async function signIn(page: Page, email = ME) {
  await page.goto("/sign-in")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD)
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  await expect(page).not.toHaveURL(/sign-in/)
  // Asked once after a fresh sign-in, unless the admin turned saved logins off.
  // Skip the "Save your login info?" offer, which is just this cookie.
  await page.context().clearCookies({ name: "nimbus_offer_save" })
  await page.reload()
  // The Next dev overlay's badge sits over the page corner.
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" })
}

// Uploads one in-memory file into the folder on screen and waits for it.
export async function upload(page: Page, name: string, body: string) {
  const chooser = page.waitForEvent("filechooser")
  await page.getByRole("button", { name: "New", exact: true }).click()
  await page.getByRole("menuitem", { name: "File upload" }).click()
  await (
    await chooser
  ).setFiles({
    name,
    mimeType: "text/plain",
    buffer: Buffer.from(body),
  })
  await expect(row(page, name)).toBeVisible()
}

// Files and folders are listbox options, in both list and grid view.
export const row = (page: Page, name: string) =>
  page.getByRole("option").filter({ hasText: name, visible: true }).first()

// Right-click an item and pick from its menu.
export async function menu(page: Page, name: string, item: string | RegExp) {
  await row(page, name).click({ button: "right" })
  await page.getByRole("menuitem", { name: item }).click()
}

export async function newFolder(page: Page, name: string) {
  await page.getByRole("button", { name: "New", exact: true }).click()
  await page.getByRole("menuitem", { name: "New folder" }).click()
  await page.getByRole("dialog").getByRole("textbox").fill(name)
  await page.getByRole("dialog").getByRole("button", { name: "Create" }).click()
  await expect(row(page, name)).toBeVisible()
}
