import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { join } from "node:path"

import { expect, test, type Page } from "@playwright/test"

import { signToken } from "../lib/upload-rules"
import { signIn } from "./helpers"

// Registry tools (/more/registry-tools) against the dev app. Needs: the app and the worker running, REGISTRY_DOMAIN set
// (the registry must be on) and, for the mirror test, internet access to Docker Hub.
// Signs in as the dev admin, which is also a member. Everything it makes carries `tag` and is deleted again.
// Cleanup test: seeds a repo straight into the registry tables (5 tagged images, 2 untagged, shared and own layers),
// checks the Dry run lists exactly what a real run removes, then ages the Trash and runs the purge and GC jobs.
// SHOTS=dir for screenshots (default /tmp).
const EMAIL = process.env.E2E_ADMIN ?? "admin-test@example.invalid"
const PASS = process.env.E2E_ADMIN_PASSWORD ?? "admin-test-pass-123"
const SHOTS = process.env.SHOTS ?? "/tmp"
const sql = (q: string) => execFileSync("psql", [process.env.DATABASE_URL ?? "postgres://nimbus:nimbus@localhost:5432/nimbus", "-qAtc", q]).toString().trim()
const tag = Date.now().toString(36)
const BASE = "/more/registry-tools"
const who = `(select id from "user" where email = '${EMAIL}')`
const digest = (s: string) => `sha256:${createHash("sha256").update(`${tag}-${s}`).digest("hex")}`
let NS = ""

async function shot(page: Page, name: string) {
  mkdirSync(SHOTS, { recursive: true })
  for (const w of [1440, 375]) {
    await page.setViewportSize({ width: w, height: w === 1440 ? 900 : 812 })
    await page.waitForTimeout(250)
    await page.screenshot({ path: join(SHOTS, `registry-tools-${name}-${w}.png`), fullPage: true })
  }
  await page.setViewportSize({ width: 1280, height: 720 })
}

const job = async (page: Page, name: string) => {
  const r = await page.request.post("/api/jobs", { headers: { authorization: `Bearer ${signToken("job", {}, 60_000)}`, "content-type": "application/json" }, data: { name, data: {} } })
  expect(r.ok()).toBeTruthy()
}

test.describe.configure({ mode: "serial" })

test.beforeAll(() => {
  // The member's own registry name, made when they have none.
  sql(`insert into registry_namespaces (name, kind, ref_id) select 'e2e-${tag}', 'user', id from "user" where email = '${EMAIL}'
    and not exists (select 1 from registry_namespaces where kind = 'user' and ref_id = "user".id)`)
  NS = sql(`select name from registry_namespaces where kind = 'user' and ref_id = ${who}`)
})

test.afterAll(() => {
  sql(`delete from registry_rules where user_id = ${who} and name like '%${tag}%'; delete from registry_repos where name like '%${tag}%'; delete from registry_tool_runs where label like '%${tag}%';
    delete from registry_namespaces where name = 'e2e-${tag}'`)
})

test("cleanup rule: the dry run is what the run removes, untagged cleanup plus GC frees blobs", async ({ page }) => {
  test.setTimeout(240_000)
  const REPO = `rt-${tag}`
  const FULL = `${NS}/${REPO}`
  sql(`insert into registry_repos (namespace_id, name) select id, '${REPO}' from registry_namespaces where name = '${NS}'`)
  const R = `(select r.id from registry_repos r join registry_namespaces n on n.id = r.namespace_id where n.name = '${NS}' and r.name = '${REPO}')`

  await test.step("seed 5 tagged and 2 untagged images", () => {
    const shared = digest("shared")
    const stmts = [`insert into registry_blobs (digest, key, size, created_at) values ('${shared}', 'registry/b/e2e-${tag}-shared', 1000, now() - interval '3 days')`,
      `insert into registry_repo_blobs (repo_id, digest, created_at) values (${R}, '${shared}', now() - interval '3 days')`]
    const image = (name: string, ageDays: number, size: number, tagged: boolean) => {
      const m = digest(`m-${name}`)
      const b = digest(`b-${name}`)
      stmts.push(
        `insert into registry_blobs (digest, key, size, created_at) values ('${b}', 'registry/b/e2e-${tag}-${name}', ${size}, now() - interval '3 days')`,
        `insert into registry_repo_blobs (repo_id, digest, created_at) values (${R}, '${b}', now() - interval '3 days')`,
        `with m as (insert into registry_manifests (repo_id, digest, media_type, bytes, size, created_at) values (${R}, '${m}', 'application/vnd.oci.image.manifest.v1+json', '\\x7b7d', 2, now() - interval '${ageDays} days') returning id)
          insert into registry_manifest_refs (manifest_id, kind, digest) select id, 'blob', d from m, (values ('${shared}'), ('${b}')) v(d)`
      )
      if (tagged) stmts.push(`insert into registry_tags (repo_id, name, digest, pushed_at) values (${R}, '${name}', '${m}', now() - interval '${ageDays} days')`)
    }
    for (const [n, age] of [["v1", 50], ["v2", 40], ["v3", 30], ["v4", 2], ["v5", 1]] as const) image(n, age, 1_000_000, true)
    image("u1", 20, 2_000_000, false)
    image("u2", 10, 2_000_000, false)
    sql(stmts.join(";\n"))
  })

  let planned: string[] = []
  await test.step("dry run lists tags and images, deletes nothing", async () => {
    await signIn(page, EMAIL, PASS)
    await page.goto(BASE)
    await expect(page.getByRole("heading", { name: "Registry tools", level: 1 })).toBeVisible()
    await page.getByRole("button", { name: "New rule" }).first().click()
    const dialog = page.getByRole("dialog", { name: "New cleanup rule" })
    await dialog.getByLabel("Name (optional)").fill(`keep two ${tag}`)
    await dialog.getByLabel("Repo", { exact: true }).selectOption({ label: FULL })
    await dialog.getByLabel("Keep the newest").fill("2")
    await dialog.getByRole("button", { name: "Dry run" }).click()
    const preview = dialog.getByRole("status").filter({ hasText: "Would remove" })
    await expect(preview).toContainText("Would remove 3 tags and 2 untagged images from 1 repo")
    await expect(preview).toContainText(/free about [\d.]+ [KMG]?B/)
    await preview.locator("summary").click()
    planned = (await preview.locator("details .font-mono").allTextContents()).filter((t) => /^v\d+$/.test(t)).sort()
    expect(planned).toEqual(["v1", "v2", "v3"])
    expect(sql(`select count(*) from registry_tags where repo_id = ${R} and deleted_at is not null`)).toBe("0")
    expect(sql(`select count(*) from registry_manifests where repo_id = ${R} and deleted_at is not null`)).toBe("0")
    await shot(page, "rule-preview")
    // Editing the form clears the stale preview.
    await dialog.getByLabel("Keep the newest").fill("3")
    await expect(preview).toHaveCount(0)
    await dialog.getByLabel("Keep the newest").fill("2")
    await dialog.getByRole("button", { name: "Add rule" }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByText(`keep two ${tag}`)).toBeVisible()
  })

  await test.step("run now removes exactly the previewed tags and the untagged images", async () => {
    await page.getByRole("button", { name: "Run now" }).first().click()
    await expect(page.getByText(/Ran: 5 items removed/)).toBeVisible()
    const gone = sql(`select name from registry_tags where repo_id = ${R} and deleted_at is not null order by name`).split("\n")
    expect(gone).toEqual(planned)
    expect(sql(`select count(*) from registry_tags where repo_id = ${R} and deleted_at is null`)).toBe("2")
    expect(sql(`select count(*) from registry_manifests where repo_id = ${R} and deleted_at is not null`)).toBe("2")
    // Still in Trash for 7 days: nothing is freed yet.
    expect(sql(`select count(*) from registry_blobs where key like 'registry/b/e2e-${tag}-%'`)).toBe("8")
    await page.goto(`${BASE}?tab=history`)
    await page.getByRole("button", { name: new RegExp(`keep two ${tag}`) }).first().click()
    await expect(page.getByText(`${FULL}: 3 tags, 2 untagged images`)).toBeVisible()
    await shot(page, "history")
  })

  await test.step("after the Trash window, purge and GC free the blobs only they used", async () => {
    sql(`update registry_tags set deleted_at = now() - interval '8 days' where repo_id = ${R} and deleted_at is not null;
      update registry_manifests set deleted_at = now() - interval '8 days' where repo_id = ${R} and deleted_at is not null`)
    await job(page, "registry-trash-purge")
    await job(page, "registry-gc")
    // The shared layer stays (v4 and v5 use it); v1-v3, u1 and u2 own layers go.
    await expect.poll(() => sql(`select count(*) from registry_blobs where key like 'registry/b/e2e-${tag}-%'`)).toBe("3")
    expect(sql(`select key from registry_blobs where key like 'registry/b/e2e-${tag}-%' order by key`).split("\n")).toEqual([`registry/b/e2e-${tag}-shared`, `registry/b/e2e-${tag}-v4`, `registry/b/e2e-${tag}-v5`])
  })
})

test("mirror: alpine:3.20 from Docker Hub with every platform, the second run skips the unchanged digest", async ({ page }) => {
  test.setTimeout(480_000)
  const TARGET = `${NS}/mirror-${tag}`
  const runs = () => sql(`select status from registry_tool_runs where user_id = ${who} and kind = 'mirror' and label = 'alpine ${tag}' order by created_at`).split("\n").filter(Boolean)

  await signIn(page, EMAIL, PASS)
  await page.goto(`${BASE}?tab=mirrors`)
  await expect(page.getByText("No mirrors yet").or(page.getByRole("button", { name: "New mirror" })).first()).toBeVisible()
  await shot(page, "mirrors-empty")

  await test.step("add the mirror", async () => {
    await page.getByRole("button", { name: "New mirror" }).first().click()
    const dialog = page.getByRole("dialog", { name: "New mirror" })
    await dialog.getByLabel("Image to mirror").fill("alpine:3.20")
    await dialog.getByLabel("Copy into").fill(TARGET)
    await dialog.getByLabel("Tags").fill("3.20")
    await dialog.getByLabel("Name (optional)").fill(`alpine ${tag}`)
    // A tag in the image name is refused with a hint.
    await dialog.getByRole("button", { name: "Add mirror" }).click()
    await expect(dialog.getByText(/Leave the tag out/)).toBeVisible()
    await dialog.getByLabel("Image to mirror").fill("alpine")
    await dialog.getByRole("button", { name: "Add mirror" }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByText(`alpine ${tag}`)).toBeVisible()
    await shot(page, "mirrors")
  })

  const first = async () => {
    // The tick may already have started it; otherwise start it now.
    const run = page.getByRole("button", { name: "Run now" }).first()
    if (!runs().length && (await run.isEnabled())) await run.click()
    await expect.poll(runs, { timeout: 240_000, intervals: [3000] }).toEqual(expect.arrayContaining(["ok"]))
  }

  await test.step("first run copies the index, every platform manifest and the blobs", async () => {
    await first()
    const repo = `(select r.id from registry_repos r join registry_namespaces n on n.id = r.namespace_id where n.name || '/' || r.name = '${TARGET}')`
    expect(sql(`select count(*) from registry_tags where repo_id = ${repo} and name = '3.20' and deleted_at is null`)).toBe("1")
    // The index plus at least one manifest per platform (alpine ships amd64, arm64, arm/v6, arm/v7, 386, ppc64le, riscv64, s390x).
    expect(Number(sql(`select count(*) from registry_manifests where repo_id = ${repo}`))).toBeGreaterThanOrEqual(6)
    expect(sql(`select count(*) from registry_manifests where repo_id = ${repo} and platforms is not null`)).toBe("1")
    expect(Number(sql(`select count(*) from registry_repo_blobs where repo_id = ${repo}`))).toBeGreaterThanOrEqual(6)
    expect(sql(`select last_digests->>'3.20' like 'sha256:%' from registry_mirrors where user_id = ${who} and name = 'alpine ${tag}'`)).toBe("t")
  })

  await test.step("second run skips the unchanged digest", async () => {
    const before = sql(`select count(*) || '|' || coalesce(sum(size), 0) from registry_blobs`)
    await page.goto(`${BASE}?tab=mirrors`)
    await page.getByRole("button", { name: "Run now" }).first().click()
    await expect.poll(() => runs().filter((s) => s === "ok").length, { timeout: 120_000, intervals: [3000] }).toBe(2)
    expect(sql(`select lines::text from registry_tool_runs where user_id = ${who} and label = 'alpine ${tag}' order by created_at desc limit 1`)).toContain("3.20: unchanged")
    expect(sql(`select changed from registry_tool_runs where user_id = ${who} and label = 'alpine ${tag}' order by created_at desc limit 1`)).toBe("0")
    expect(sql(`select count(*) || '|' || coalesce(sum(size), 0) from registry_blobs`)).toBe(before)
    await page.goto(`${BASE}?tab=history`)
    await page.getByRole("button", { name: new RegExp(`alpine ${tag}`) }).first().click()
    await expect(page.getByText("3.20: unchanged")).toBeVisible()
  })

  await test.step("an upstream change sends a bell", async () => {
    // Pretend the last run saw another digest, then run again.
    sql(`update registry_mirrors set last_digests = jsonb_build_object('3.20', 'sha256:${"0".repeat(64)}') where user_id = ${who} and name = 'alpine ${tag}'`)
    await page.goto(`${BASE}?tab=mirrors`)
    await page.getByRole("button", { name: "Run now" }).first().click()
    await expect.poll(() => sql(`select count(*) from notifications where user_id = ${who} and kind = 'registry_mirror' and data->>'event' = 'changed' and data->>'name' = 'alpine ${tag}'`), { timeout: 120_000, intervals: [3000] }).toBe("1")
  })
})

test("tool pages: admin switch hides it, mobile width has no sideways scroll", async ({ page }) => {
  await signIn(page, EMAIL, PASS)
  for (const tab of ["", "?tab=mirrors", "?tab=history"]) {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto(`${BASE}${tab}`)
    await expect(page.getByRole("heading", { name: "Registry tools", level: 1 })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
  const was = sql(`select registry_tools_enabled from settings`)
  try {
    sql(`update settings set registry_tools_enabled = false`)
    expect((await page.goto(BASE))?.status()).toBe(404)
  } finally {
    sql(`update settings set registry_tools_enabled = ${was === "t"}`)
  }
})
