import { execFileSync } from "node:child_process"

import { expect, test, type Page } from "@playwright/test"

import { PASSWORD } from "./helpers"

// A throwaway member (sign up, then approve and give it two-factor in the
// database). Chrome's virtual authenticator stands in for a fingerprint reader.
const EMAIL = process.env.E2E_PASSKEY_EMAIL ?? "passkey-test@example.invalid"

async function authenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("WebAuthn.enable")
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
}

// The password step through the API: on the sign-in page the virtual
// authenticator would answer the passkey autofill first.
async function apiSignIn(page: Page) {
  const r = await page.request.post("/api/auth/sign-in/email", {
    data: { email: EMAIL, password: PASSWORD },
    headers: { origin: "http://localhost:3000" },
  })
  return (await r.json()) as { twoFactorRedirect?: boolean }
}

async function passwordSignIn(page: Page) {
  await page.goto("/sign-in")
  await page.getByLabel("Email").fill(EMAIL)
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD)
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
}

test("add, rename and remove a passkey, then sign in with it", async ({ page }) => {
  await authenticator(page)
  await passwordSignIn(page)
  await expect(page).not.toHaveURL(/sign-in/)
  // Skip the "Save your login info?" offer, which hides the page from the tree.
  await page.context().clearCookies({ name: "nimbus_offer_save" })
  await page.goto("/account")
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" })

  await page.getByLabel("Name for the new passkey").fill("Laptop")
  await page.getByRole("button", { name: "Add a passkey" }).click()
  await expect(page.getByText("Laptop", { exact: true })).toBeVisible()

  await page.getByRole("button", { name: "Rename" }).click()
  await page.getByLabel("Passkey name").fill("Desk")
  await page.locator("#passkeys").getByRole("button", { name: "Save", exact: true }).click()
  await expect(page.getByText("Desk", { exact: true })).toBeVisible()

  // A passkey sign-in skips the code and the password.
  await page.context().clearCookies()
  await page.goto("/sign-in")
  await page.getByRole("button", { name: "Sign in with a passkey" }).click()
  await expect(page).not.toHaveURL(/sign-in/)
  await page.context().clearCookies({ name: "nimbus_offer_save" })

  await page.goto("/account")
  await page.getByRole("button", { name: "Remove", exact: true }).click()
  await page.getByRole("button", { name: "Remove it" }).click()
  await expect(page.getByText("Desk", { exact: true })).toHaveCount(0)
})

// Sets two-factor on or off for the test member straight in the database.
function twoFactor(on: boolean) {
  execFileSync("psql", [
    process.env.DATABASE_URL ??
      "postgres://nimbus:nimbus@localhost:5432/nimbus",
    "-qc",
    `update "user" set two_factor_enabled = ${on} where email = '${EMAIL}'`,
  ])
}

test("a passkey answers the two-factor step, and trusts the device", async ({
  page,
}) => {
  await authenticator(page)
  await passwordSignIn(page)
  await expect(page).not.toHaveURL(/sign-in/)
  await page.context().clearCookies({ name: "nimbus_offer_save" })
  await page.goto("/account")
  await page.getByLabel("Name for the new passkey").fill("Phone")
  await page.getByRole("button", { name: "Add a passkey" }).click()
  await expect(page.getByText("Phone", { exact: true })).toBeVisible()

  twoFactor(true)
  try {
    await page.context().clearCookies()
    expect((await apiSignIn(page)).twoFactorRedirect).toBe(true)
    await page.goto("/two-factor")
    await page.getByLabel("Don't ask again").check()
    await page.getByRole("button", { name: "Use a passkey" }).click()
    await expect(page).toHaveURL(/localhost:3000\/$/)

    // Trusted: the next password sign-in asks for nothing.
    await page.request.post("/api/auth/sign-out", {
      data: {},
      headers: { origin: "http://localhost:3000" },
    })
    expect((await apiSignIn(page)).twoFactorRedirect).toBeFalsy()

    await page.context().clearCookies({ name: "nimbus_offer_save" })
    await page.goto("/account")
    await page.getByRole("button", { name: "Remove", exact: true }).click()
    await page.getByRole("button", { name: "Remove it" }).click()
    await expect(page.getByText("Phone", { exact: true })).toHaveCount(0)
  } finally {
    twoFactor(false)
  }
})

// Flips the admin rule for a few seconds: it gates every account on the instance.
const rule = (on: boolean) =>
  execFileSync("psql", [
    process.env.DATABASE_URL ??
      "postgres://nimbus:nimbus@localhost:5432/nimbus",
    "-qc",
    `update settings set require_passkey = ${on}`,
  ])

test("a required passkey sends a member to the setup screen", async ({
  page,
}) => {
  await authenticator(page)
  await passwordSignIn(page)
  await expect(page).not.toHaveURL(/sign-in/)
  await page.context().clearCookies({ name: "nimbus_offer_save" })
  rule(true)
  try {
    await page.goto("/account")
    await expect(
      page.getByRole("heading", { name: "Set up a passkey to continue" })
    ).toBeVisible()
    await page.getByRole("button", { name: "Add a passkey" }).click()
    await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible()
  } finally {
    rule(false)
  }
  await page.getByRole("button", { name: "Remove", exact: true }).click()
  await page.getByRole("button", { name: "Remove it" }).click()
})
