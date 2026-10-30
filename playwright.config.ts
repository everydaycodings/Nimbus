import { defineConfig, devices } from "@playwright/test"

// Runs against a Nimbus that's already up (npm run dev, the worker and tusd).
// E2E_URL, E2E_EMAIL, E2E_EMAIL2 and E2E_PASSWORD pick the instance and the
// two members it signs in as (see README, End-to-end tests).
export default defineConfig({
  testDir: "e2e",
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.E2E_URL ?? "http://localhost:3000",
    permissions: ["clipboard-read", "clipboard-write"],
    trace: "retain-on-failure",
  },
})
