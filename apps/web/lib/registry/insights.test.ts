// Run: node --test lib/registry/insights.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import {
  baseFromOs, cleanImagePolicy, blockedLicenseHits, diffLayers, diffPackages, diffVulns, evaluateImagePolicy, isArtifactManifest, packagesCsv, parseImageRef, parseSbom, parseTagVersion,
  parseTrivyFull, pickCandidates, spdxFrom, type Facts, type Pkg, type Vuln,
} from "./extras-rules.ts"

const P = (name: string, version: string, type = "os"): Pkg => ({ name, version, type, licenses: [] })

test("package diff: added, removed, changed by name and type", () => {
  const a = [P("musl", "1.1.1"), P("busybox", "1.0"), P("left", "1", "npm"), P("same", "2")]
  const b = [P("musl", "1.2.5"), P("curl", "8"), P("left", "2", "npm"), P("same", "2"), P("left", "9")]
  const d = diffPackages(a, b)
  assert.deepEqual(d.added.map((p) => p.name), ["curl", "left"])
  assert.deepEqual(d.removed.map((p) => p.name), ["busybox"])
  assert.deepEqual(d.changed, [{ name: "left", type: "npm", from: "1", to: "2" }, { name: "musl", type: "os", from: "1.1.1", to: "1.2.5" }])
  // same name, different type: not a change
  const t = diffPackages([P("x", "1", "os")], [P("x", "1", "npm")])
  assert.equal(t.added.length, 1)
  assert.equal(t.removed.length, 1)
  assert.equal(t.changed.length, 0)
})

test("vuln diff: fixed and introduced, an upgrade that keeps a CVE is neither", () => {
  const v = (id: string, pkg: string, severity: Vuln["severity"] = "HIGH", installed = "1"): Vuln => ({ id, pkg, installed, fixed: null, severity, title: null })
  const d = diffVulns([v("A", "p", "LOW"), v("B", "p", "CRITICAL"), v("C", "q")], [v("C", "q", "HIGH", "2"), v("D", "r")])
  assert.deepEqual(d.fixed.map((x) => x.id), ["B", "A"])
  assert.deepEqual(d.introduced.map((x) => x.id), ["D"])
})

test("layer diff", () => {
  const l = (digest: string, size: number) => ({ digest, size })
  assert.deepEqual(diffLayers([l("a", 10), l("b", 20)], [l("a", 10), l("c", 5)]), { shared: 1, onlyA: 1, onlyB: 1, sizeA: 30, sizeB: 15 })
})

test("trivy packages: class, purl type, licenses, layer, dedupe, OS", () => {
  const r = parseTrivyFull({
    Metadata: { OS: { Family: "alpine", Name: "3.10.9" } },
    Results: [
      { Class: "os-pkgs", Type: "alpine", Packages: [{ Name: "musl", Version: "1.1.22-r4", Licenses: ["MIT"], Identifier: { PURL: "pkg:apk/alpine/musl@1.1.22-r4" }, Layer: { DiffID: "sha256:aa" } }, { Name: "musl", Version: "1.1.22-r4" }] },
      { Class: "lang-pkgs", Type: "node-pkg", Packages: [{ Name: "left-pad", Version: "1.0.0", Identifier: { PURL: "pkg:npm/left-pad@1.0.0" } }, { Name: "py", Version: "2" }] },
      { Class: "os-pkgs", Packages: null },
    ],
  })
  assert.deepEqual(r.packages.map((p) => [p.name, p.type]), [["musl", "os"], ["left-pad", "npm"], ["py", "node-pkg"]])
  assert.deepEqual(r.packages[0].licenses, ["MIT"])
  assert.equal(r.packages[0].layer, "sha256:aa")
  assert.deepEqual(baseFromOs(r.os), { name: "library/alpine", tag: "3.10" })
})

test("SBOM: SPDX 2.3", () => {
  const doc = {
    spdxVersion: "SPDX-2.3",
    packages: [
      { name: "image", SPDXID: "SPDXRef-DocumentRoot" },
      { name: "musl", versionInfo: "1.2.5", licenseDeclared: "MIT", licenseConcluded: "NOASSERTION", externalRefs: [{ referenceType: "purl", referenceLocator: "pkg:apk/alpine/musl@1.2.5" }] },
      { name: "lodash", versionInfo: "4.17.21", licenseConcluded: "MIT", externalRefs: [{ referenceType: "purl", referenceLocator: "pkg:npm/lodash@4.17.21" }] },
    ],
  }
  const r = parseSbom(doc)!
  assert.equal(r.format, "spdx")
  assert.deepEqual(r.packages.map((p) => [p.name, p.version, p.type, p.licenses]), [["musl", "1.2.5", "os", ["MIT"]], ["lodash", "4.17.21", "npm", ["MIT"]]])
})

test("SBOM: CycloneDX 1.5", () => {
  const r = parseSbom({ bomFormat: "CycloneDX", specVersion: "1.5", components: [
    { type: "library", name: "zlib", version: "1.3", purl: "pkg:apk/alpine/zlib@1.3", licenses: [{ license: { id: "Zlib" } }] },
    { type: "library", name: "x", version: "1", licenses: [{ expression: "MIT OR Apache-2.0" }] },
    { type: "file", name: "/etc/passwd" },
  ] })!
  assert.equal(r.format, "cyclonedx")
  assert.deepEqual(r.packages.map((p) => [p.name, p.type, p.licenses]), [["zlib", "os", ["Zlib"]], ["x", "unknown", ["MIT OR Apache-2.0"]]])
})

test("SBOM: in-toto statement (BuildKit) and DSSE envelope unwrap", () => {
  const spdx = { spdxVersion: "SPDX-2.3", packages: [{ name: "busybox", versionInfo: "1.36", externalRefs: [{ referenceType: "purl", referenceLocator: "pkg:apk/alpine/busybox@1.36" }] }] }
  const statement = { _type: "https://in-toto.io/Statement/v0.1", predicateType: "https://spdx.dev/Document", subject: [], predicate: spdx }
  assert.equal(parseSbom(statement)!.packages[0].name, "busybox")
  const dsse = { payloadType: "application/vnd.in-toto+json", payload: Buffer.from(JSON.stringify(statement)).toString("base64") }
  assert.equal(parseSbom(dsse)!.format, "spdx")
  assert.equal(parseSbom({ _type: "x", predicate: { buildType: "slsa" } }), null)
  assert.equal(parseSbom("nope"), null)
})

test("exports: csv quoting and a round-trippable SPDX document", () => {
  const pk = [{ ...P("a,b", "1"), licenses: ["MIT", "GPL-2.0"], purl: "pkg:apk/a@1" }]
  assert.equal(packagesCsv(pk), 'name,version,type,licenses,purl\n"a,b",1,os,MIT GPL-2.0,pkg:apk/a@1\n')
  const back = parseSbom(spdxFrom("x", pk))!
  assert.deepEqual(back.packages.map((p) => [p.name, p.version, p.type]), [["a,b", "1", "os"]])
})

const none: Facts = { critical: null, high: null, ageDays: null, signed: null, licenses: null }
test("policy evaluation matrix", () => {
  const pol = { maxCritical: 0, maxHigh: 5, maxAgeDays: 90, requireSigned: true, blockedLicenses: ["GPL-3.0"] }
  // unscanned and unknown: everything passes
  const u = evaluateImagePolicy(pol, none)
  assert.equal(u.pass, true)
  assert.equal(u.checks.length, 5)
  assert.match(u.checks[0].detail, /Not scanned/)
  // everything fails
  const bad = evaluateImagePolicy(pol, { critical: 2, high: 9, ageDays: 400, signed: false, licenses: ["GPL-3.0-only AND MIT"] })
  assert.equal(bad.pass, false)
  assert.deepEqual(bad.checks.map((c) => c.pass), [false, false, false, false, false])
  // at the limit passes
  const edge = evaluateImagePolicy(pol, { critical: 0, high: 5, ageDays: 90, signed: true, licenses: ["MIT"] })
  assert.equal(edge.pass, true)
  // only configured checks appear; null limits skipped
  assert.deepEqual(evaluateImagePolicy({ maxCritical: 0, maxHigh: null }, { ...none, critical: 1 }).checks.map((c) => c.key), ["maxCritical"])
  assert.deepEqual(evaluateImagePolicy({}, none), { pass: true, checks: [] })
})

test("blocked licenses match SPDX ids loosely", () => {
  assert.deepEqual(blockedLicenseHits(["GPL-3.0"], ["gpl-3.0-or-later", "MIT"]), ["GPL-3.0"])
  assert.deepEqual(blockedLicenseHits(["GPL-3.0"], ["(MIT OR GPL-3.0+)"]), ["GPL-3.0"])
  assert.deepEqual(blockedLicenseHits(["GPL-3.0"], ["LGPL-3.0", "GPL-2.0-only"]), [])
  assert.deepEqual(blockedLicenseHits(["AND"], ["MIT AND X"]), [])
})

test("artifact manifests are told apart from images", () => {
  assert.equal(isArtifactManifest({ subject: {} }), true)
  assert.equal(isArtifactManifest({ config: { mediaType: "application/vnd.dev.cosign.artifact.sig.v1+json" } }), true)
  assert.equal(isArtifactManifest({ config: { mediaType: "application/vnd.oci.image.config.v1+json" }, layers: [{ mediaType: "application/vnd.in-toto+json" }] }), true)
  assert.equal(isArtifactManifest({ config: { mediaType: "application/vnd.oci.image.config.v1+json" }, layers: [{ mediaType: "application/vnd.oci.image.layer.v1.tar+gzip" }] }), false)
  assert.equal(isArtifactManifest({ manifests: [] }), false)
  assert.equal(isArtifactManifest({}, `sha256-${"a".repeat(64)}.sig`), true)
})

test("image refs and base detection", () => {
  assert.deepEqual(parseImageRef("alpine:3.10"), { registry: "docker.io", repo: "library/alpine", tag: "3.10" })
  assert.deepEqual(parseImageRef("docker.io/library/alpine:3.10@sha256:ab"), { registry: "docker.io", repo: "library/alpine", tag: "3.10" })
  assert.deepEqual(parseImageRef("ghcr.io/o/app:v1"), { registry: "ghcr.io", repo: "o/app", tag: "v1" })
  assert.deepEqual(parseImageRef("myorg/app"), { registry: "docker.io", repo: "myorg/app", tag: "latest" })
  assert.equal(parseImageRef("scratch"), null)
})

test("advice variants: node:18-alpine and alpine:3.10", () => {
  assert.deepEqual(parseTagVersion("18.2.0-alpine3.18"), { nums: [18, 2, 0], variant: "alpine", vnums: [3, 18] })
  assert.equal(parseTagVersion("latest"), null)
  assert.equal(parseTagVersion("22-rc-alpine"), null)
  const node = ["16-alpine", "18-alpine", "20-alpine", "22-alpine", "22", "22-slim", "22.1.0-alpine", "lts-alpine", "23-alpine3.20", "23-alpine"]
  assert.deepEqual(pickCandidates("18-alpine", node), [{ tag: "23-alpine", level: "major" }])
  const alpine = ["3.9", "3.10", "3.11", "3.20", "3.22", "3.22.1", "edge", "latest", "20240101"]
  assert.deepEqual(pickCandidates("3.10", alpine), [{ tag: "3.22", level: "minor" }])
  const semver = ["1.2.3", "1.2.9", "1.4.0", "2.0.0", "1.2.9-slim", "1.2"]
  assert.deepEqual(pickCandidates("1.2.3", semver), [{ tag: "1.2.9", level: "patch" }, { tag: "1.4.0", level: "minor" }, { tag: "2.0.0", level: "major" }])
  // keeps the variant, including the distro version suffix going up
  assert.deepEqual(pickCandidates("18.2.0-alpine3.18", ["18.2.0-alpine3.20", "18.2.0-slim", "18.9.0-alpine3.20"]).map((c) => c.tag), ["18.2.0-alpine3.20", "18.9.0-alpine3.20"])
  assert.deepEqual(pickCandidates("latest", alpine), [])
})

test("policy input is cleaned", () => {
  assert.equal(cleanImagePolicy({}), null)
  assert.equal(cleanImagePolicy({ blockPulls: true }), null)
  assert.deepEqual(cleanImagePolicy({ maxCritical: "0" as never, maxHigh: -3, maxAgeDays: 99999, blockedLicenses: ["GPL-3.0", " gpl-3.0 ", "bad lic", "x".repeat(70)], blockPulls: true }), { maxCritical: 0, maxHigh: 0, maxAgeDays: 3650, blockedLicenses: ["GPL-3.0", "gpl-3.0"], blockPulls: true })
  assert.deepEqual(cleanImagePolicy({ maxCritical: null, requireSigned: true }), { requireSigned: true })
})
