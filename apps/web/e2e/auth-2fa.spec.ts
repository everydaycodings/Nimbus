import { base32 } from "@better-auth/utils/base32"
import { createOTP } from "@better-auth/utils/otp"
import { expect, test, type Page } from "@playwright/test"
import postgres from "postgres"

// Sign-up, sign-in and two-factor for a password account and for an account
// with no password (Google, GitHub, OIDC). Needs DATABASE_URL to approve the
// new members and to turn one into a provider-only account.
const sql = postgres(process.env.DATABASE_URL!)
test.afterAll(async () => {
  await sql`delete from "user" where email like 'e2e-2fa-%@example.invalid'`
  await sql`update settings set secret_require_2fa = false, require_2fa = false`
  await sql.end()
})

// The "Save your login info?" offer can pop up after any sign-in or refresh.
test.beforeEach(async ({ page }) => {
  await page.addLocatorHandler(
    page.getByRole("dialog", { name: "Save your login info?" }),
    (d) => d.getByRole("button", { name: "Not now" }).click()
  )
})

const PASSWORD = "e2e-2fa-pass-12345"
const stamp = () => Date.now().toString(36)
const totp = (secret: string) =>
  createOTP(new TextDecoder().decode(base32.decode(secret)), {
    digits: 6,
    period: 30,
  }).totp()
// Opens a page without the "Save your login info?" offer or the dev overlay.
async function go(page: Page, path: string) {
  await page.context().clearCookies({ name: "nimbus_offer_save" })
  await page.goto(path)
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" })
}

async function signUp(page: Page, email: string) {
  await page.goto("/sign-up")
  await page.getByLabel("Name").fill("E2E 2FA")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD)
  await page.getByRole("button", { name: "Create account" }).click()
  await expect(page.getByText("Waiting for approval")).toBeVisible()
  await sql`update "user" set status = 'active' where email = ${email}`
}

async function signIn(page: Page, email: string) {
  await page.context().clearCookies()
  await page.goto("/sign-in")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD)
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
}

// Account page → set up → QR → code → backup codes. Returns the secret and codes.
async function turnOn(page: Page, password: string | null) {
  await go(page, "/account")
  await page.getByRole("button", { name: "Set up two-factor" }).click()
  if (password !== null) {
    await page.getByLabel("Confirm your password to start").fill(password)
    await page.getByRole("button", { name: "Continue" }).click()
  }
  await expect(page.getByText("Scan this with an authenticator app")).toBeVisible()
  const key = (await page.locator("code").first().innerText()).replace(/\s/g, "")
  await page.getByLabel("Enter the 6-digit code it shows").fill("000000")
  await page.getByRole("button", { name: "Turn on two-factor" }).click()
  await expect(page.getByText("That code didn't match")).toBeVisible()
  await page.getByLabel("Enter the 6-digit code it shows").fill(await totp(key))
  await page.getByRole("button", { name: "Turn on two-factor" }).click()
  await expect(page.getByText("Save your backup codes")).toBeVisible()
  const codes = await page.locator("ul.font-mono li").allInnerTexts()
  expect(codes).toHaveLength(10)
  await page.getByRole("button", { name: "I've saved them" }).click()
  await expect(page.getByRole("button", { name: "New backup codes" })).toBeVisible()
  return { key, codes }
}

test("password account: sign up, sign in, two-factor on, sign in with code and backup code, off", async ({ page }) => {
  const email = `e2e-2fa-pw-${stamp()}@example.invalid`
  await signUp(page, email)

  // Wrong password, then the right one.
  await page.context().clearCookies()
  await page.goto("/sign-in")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password", { exact: true }).fill("not-the-password")
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  await expect(page).toHaveURL(/sign-in/)
  await signIn(page, email)
  await expect(page).not.toHaveURL(/sign-in|two-factor/)

  // A password account still needs its password to start.
  await go(page, "/account")
  await page.getByRole("button", { name: "Set up two-factor" }).click()
  await page.getByLabel("Confirm your password to start").fill("wrong-password-1")
  await page.getByRole("button", { name: "Continue" }).click()
  await expect(page.getByRole("alert")).toBeVisible()
  const { key, codes } = await turnOn(page, PASSWORD)

  // Signing in now asks for the code.
  await signIn(page, email)
  await expect(page).toHaveURL(/two-factor/)
  await page.getByLabel("Code from your authenticator app").fill("000000")
  await page.getByRole("button", { name: "Verify" }).click()
  await expect(page.getByText("That code didn't match")).toBeVisible()
  await page.getByLabel("Code from your authenticator app").fill(await totp(key))
  await page.getByRole("button", { name: "Verify" }).click()
  await expect(page).not.toHaveURL(/two-factor|sign-in/)

  // A backup code works once.
  await signIn(page, email)
  await expect(page).toHaveURL(/two-factor/)
  await page.getByRole("button", { name: "Lost your phone? Use a backup code" }).click()
  await page.getByLabel("Backup code").fill(codes[0])
  await page.getByRole("button", { name: "Verify" }).click()
  await expect(page).not.toHaveURL(/two-factor|sign-in/)
  await signIn(page, email)
  await page.getByRole("button", { name: "Lost your phone? Use a backup code" }).click()
  await page.getByLabel("Backup code").fill(codes[0])
  await page.getByRole("button", { name: "Verify" }).click()
  await expect(page.getByText("That backup code didn't work")).toBeVisible()
  await page.getByLabel("Backup code").fill(codes[1])
  await page.getByRole("button", { name: "Verify" }).click()
  await expect(page).not.toHaveURL(/two-factor|sign-in/)

  // New codes and turning off both take the password.
  await go(page, "/account")
  await page.getByRole("button", { name: "New backup codes" }).click()
  await page.getByLabel("Confirm your password", { exact: true }).fill(PASSWORD)
  await page.getByRole("button", { name: "Make new codes" }).click()
  await expect(page.getByText("Save your backup codes")).toBeVisible()
  await page.getByRole("button", { name: "I've saved them" }).click()
  await page.getByRole("button", { name: "Turn off" }).click()
  await page.getByLabel("Confirm your password to turn off two-factor").fill(PASSWORD)
  await page.getByRole("button", { name: "Turn off two-factor" }).click()
  await expect(page.getByRole("button", { name: "Set up two-factor" })).toBeVisible()

  // And sign-in no longer asks.
  await signIn(page, email)
  await expect(page).not.toHaveURL(/two-factor|sign-in/)
})

test("account without a password: two-factor on with a code, Secrets gate, off with a code", async ({ page }) => {
  const email = `e2e-2fa-g-${stamp()}@example.invalid`
  await signUp(page, email)
  await signIn(page, email)
  await expect(page).not.toHaveURL(/sign-in/)
  // Now it's a Google-only account, as if it signed up with Google.
  await sql`delete from account where provider_id = 'credential' and user_id = (select id from "user" where email = ${email})`
  await sql`insert into account (id, account_id, provider_id, user_id, created_at, updated_at)
    select 'e2e-g-' || id, 'e2e-g-' || id, 'google', id, now(), now() from "user" where email = ${email}`
  await sql`update settings set secret_require_2fa = true`

  await go(page, "/secrets")
  await expect(page.getByText("Turn on two-factor first")).toBeVisible()

  await go(page, "/account")
  await expect(page.getByText("doesn't keep a password for you")).toBeVisible()
  const { key } = await turnOn(page, null)

  await go(page, "/secrets")
  await expect(page.getByText("Turn on two-factor first")).toHaveCount(0)

  // New backup codes and turning off take a current code, not a password.
  await go(page, "/account")
  await page.getByRole("button", { name: "New backup codes" }).click()
  await page.getByLabel("Enter the code from your authenticator app").fill("000000")
  await page.getByRole("button", { name: "Make new codes" }).click()
  await expect(page.getByText("That code didn't match")).toBeVisible()
  await page.getByLabel("Enter the code from your authenticator app").fill(await totp(key))
  await page.getByRole("button", { name: "Make new codes" }).click()
  await expect(page.getByText("Save your backup codes")).toBeVisible()
  await page.getByRole("button", { name: "I've saved them" }).click()

  await page.getByRole("button", { name: "Turn off" }).click()
  const off = page.getByLabel("Enter the code from your authenticator app to turn off two-factor")
  await off.fill("000000")
  await page.getByRole("button", { name: "Turn off two-factor" }).click()
  await expect(page.getByText("That code didn't match")).toBeVisible()
  await off.fill(await totp(key))
  await page.getByRole("button", { name: "Turn off two-factor" }).click()
  await expect(page.getByRole("button", { name: "Set up two-factor" })).toBeVisible()

  await go(page, "/secrets")
  await expect(page.getByText("Turn on two-factor first")).toBeVisible()
})

test("required two-factor stops an account without a password until it sets it up", async ({ page }) => {
  const email = `e2e-2fa-req-${stamp()}@example.invalid`
  await signUp(page, email)
  await signIn(page, email)
  await expect(page).not.toHaveURL(/sign-in/)
  await sql`delete from account where provider_id = 'credential' and user_id = (select id from "user" where email = ${email})`
  await sql`insert into account (id, account_id, provider_id, user_id, created_at, updated_at)
    select 'e2e-g-' || id, 'e2e-g-' || id, 'google', id, now(), now() from "user" where email = ${email}`
  await sql`update settings set require_2fa = true`
  try {
    await go(page, "/")
    await expect(page.getByText("Set up two-factor to continue")).toBeVisible()
    await page.getByRole("button", { name: "Set up two-factor" }).click()
    await expect(page.getByText("Scan this with an authenticator app")).toBeVisible()
    const key = (await page.locator("code").first().innerText()).replace(/\s/g, "")
    await page.getByLabel("Enter the 6-digit code it shows").fill(await totp(key))
    await page.getByRole("button", { name: "Turn on two-factor" }).click()
    await page.getByRole("button", { name: "I've saved them" }).click()
    await expect(page.getByText("Set up two-factor to continue")).toHaveCount(0)
    await go(page, "/account")
    // Required: it can't be turned off.
    await expect(page.getByText("Your admin requires two-factor, so it can't be turned off.")).toBeVisible()
  } finally {
    await sql`update settings set require_2fa = false`
  }
})
