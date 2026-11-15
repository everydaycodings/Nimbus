import assert from "node:assert/strict"
import { test } from "node:test"

import { buildctlArgs, expandTags, latestTag, matchRule, maskLine, parseRef, validateRule } from "./build-rules.ts"

const sha = "0123456789abcdef"

test("branch build: latest, sha and sanitized branch", () => {
  assert.deepEqual(expandTags(["latest", "{sha}", "{branch}"], { branch: "feature/Login Page", sha }), ["latest", "0123456", "feature-Login-Page"])
})
test("semver tag gives version, major.minor and major", () => {
  assert.deepEqual(expandTags(["{version}", "{major}.{minor}", "{major}", "latest"], { tag: "v1.2.3", sha }), ["1.2.3", "1.2", "1", "latest"])
})
test("prerelease only gets {version}", () => {
  assert.deepEqual(expandTags(["{version}", "{major}.{minor}", "{major}"], { tag: "v2.0.0-rc.1", sha }), ["2.0.0-rc.1"])
})
test("placeholders without a value are skipped, build metadata is dropped", () => {
  assert.deepEqual(expandTags(["{branch}", "{version}", "{tag}"], { tag: "nightly", sha }), ["nightly"])
  assert.deepEqual(expandTags(["{version}"], { tag: "1.0.0+build5", sha }), ["1.0.0"])
})
test("duplicates collapse and bad tags are dropped", () => {
  assert.deepEqual(expandTags(["latest", "latest", "-bad"], { branch: "main", sha }), ["latest"])
})
test("matchRule: glob, regex and type", () => {
  assert.equal(matchRule({ sourceType: "branch", pattern: "release/*" }, { type: "branch", name: "release/1.x" }), true)
  assert.equal(matchRule({ sourceType: "branch", pattern: "main" }, { type: "tag", name: "main" }), false)
  assert.equal(matchRule({ sourceType: "tag", pattern: "re:^v\\d+\\.\\d+\\.\\d+$" }, { type: "tag", name: "v1.2.3" }), true)
  assert.equal(matchRule({ sourceType: "tag", pattern: "re:^v\\d+\\.\\d+\\.\\d+$" }, { type: "tag", name: "v1.2.3-rc" }), false)
})
test("parseRef and latestTag", () => {
  assert.deepEqual(parseRef("refs/heads/feat/x"), { type: "branch", name: "feat/x" })
  assert.deepEqual(parseRef("refs/tags/v1"), { type: "tag", name: "v1" })
  assert.equal(parseRef("refs/pull/1/head"), null)
  assert.equal(latestTag(["v1.2.3", "v1.10.0", "v1.9.9", "v2.0.0-rc.1"]), "v1.10.0")
})

const base = { sourceType: "branch", pattern: "main", tags: ["latest"] }
test("validateRule accepts a minimal rule and fills defaults", () => {
  const { rule, error } = validateRule(base)
  assert.equal(error, undefined)
  assert.equal(rule!.dockerfile, "Dockerfile")
  assert.equal(rule!.context, ".")
  assert.deepEqual(rule!.platforms, [])
  assert.equal(rule!.enabled, true)
})
test("validateRule rejects bad input", () => {
  assert.match(validateRule({ ...base, sourceType: "x" }).error!, /Branch or Tag/)
  assert.match(validateRule({ ...base, pattern: "re:(" }).error!, /regular expression/)
  assert.match(validateRule({ ...base, tags: [] }).error!, /image tags/)
  assert.match(validateRule({ ...base, tags: ["{nope}"] }).error!, /placeholder/)
  assert.match(validateRule({ ...base, dockerfile: "../x" }).error!, /inside the repository/)
  assert.match(validateRule({ ...base, platforms: ["windows/amd64"] }).error!, /Platforms/)
  assert.match(validateRule({ ...base, schedule: "every day" }).error!, /cron/)
  assert.match(validateRule({ ...base, buildArgs: [{ key: "A", value: "1" }, { key: "A", value: "2" }] }).error!, /twice/)
  assert.match(validateRule({ ...base, buildArgs: [{ key: "1bad", value: "" }] }).error!, /valid build argument/)
})
test("validateRule keeps good extras", () => {
  const { rule } = validateRule({ ...base, schedule: "*/5  * * * *", platforms: ["linux/arm64", "linux/arm64"], secretRefs: [{ id: "a", projectId: "p", env: "prod", key: "NPM_TOKEN" }] })
  assert.equal(rule!.schedule, "*/5 * * * *")
  assert.deepEqual(rule!.platforms, ["linux/arm64"])
  assert.equal(rule!.secretRefs[0].key, "NPM_TOKEN")
})

test("buildctl line: secrets by env name, args, cache, by-digest output", () => {
  const a = buildctlArgs({ addr: "tcp://b:1234", contextDir: "/w/c", dockerfileDir: "/w", dockerfileName: "Dockerfile", platforms: ["linux/amd64"], buildArgs: [{ key: "A", value: "b c" }], secretEnv: [{ id: "NPM_TOKEN", env: "NIMBUS_SECRET_0" }], image: "registry:3408/me/app", insecure: true, metadataFile: "/w/meta.json" })
  assert.ok(a.includes("id=NPM_TOKEN,env=NIMBUS_SECRET_0"))
  assert.ok(a.includes("build-arg:A=b c"))
  assert.ok(a.includes("platform=linux/amd64"))
  assert.ok(a.some((x) => x.startsWith("type=image,name=registry:3408/me/app,push-by-digest=true")))
  assert.ok(a.includes("type=registry,ref=registry:3408/me/app:buildcache,registry.insecure=true"))
  assert.ok(!a.join(" ").includes("secret-value"))
})
test("maskLine hides values and their base64, not short ones", () => {
  const v = "s3cret-token"
  assert.equal(maskLine(`x ${v} y ${Buffer.from(v).toString("base64")}`, [v]), "x *** y ***")
  assert.equal(maskLine("a b", ["a"]), "a b")
})
