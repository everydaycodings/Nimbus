// Run: node --test lib/registry/extras-rules.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import { attestationRefs, classify, compact, cosignTags, count, fillDays, maxOf, newCriticals, parseTrivy, safeUrl } from "./extras-rules.ts"

test("classify signatures, SBOMs and attestations", () => {
  assert.equal(classify("application/vnd.dev.cosign.simplesigning.v1+json"), "signature")
  assert.equal(classify("application/vnd.dev.sigstore.bundle.v0.3+json"), "signature")
  assert.equal(classify("application/vnd.cncf.notary.signature"), "signature")
  assert.equal(classify("application/spdx+json"), "sbom")
  assert.equal(classify("application/vnd.cyclonedx+json"), "sbom")
  assert.equal(classify("application/vnd.in-toto+json"), "attestation")
  assert.equal(classify(null, "https://spdx.dev/Document"), "sbom")
  assert.equal(classify(null, "https://slsa.dev/provenance/v0.2"), "attestation")
  assert.equal(classify("application/vnd.example.helm.chart"), "other")
})

test("cosign tag names", () => {
  assert.deepEqual(cosignTags("sha256:ab"), { "sha256-ab.sig": "signature", "sha256-ab.att": "attestation", "sha256-ab.sbom": "sbom" })
})

test("buildx attestation manifests are found in an index", () => {
  const r = attestationRefs({
    manifests: [
      { digest: "sha256:a", annotations: {} },
      { digest: "sha256:b", annotations: { "vnd.docker.reference.type": "attestation-manifest", "vnd.docker.reference.digest": "sha256:a" } },
    ],
  })
  assert.deepEqual(r, [{ digest: "sha256:b", target: "sha256:a" }])
})

test("pull stats are zero-filled and end today", () => {
  const out = fillDays([{ day: "2026-11-14", count: 3 }, { day: "2026-11-10", count: 1 }], 7, "2026-11-15")
  assert.equal(out.length, 7)
  assert.deepEqual(out[0], { day: "2026-11-09", count: 0 })
  assert.deepEqual(out.at(-1), { day: "2026-11-15", count: 0 })
  assert.deepEqual(out.map((o) => o.count), [0, 1, 0, 0, 0, 3, 0])
})

test("trivy report: parse, dedupe, count, max over platforms", () => {
  const v = (id: string, s: string, pkg = "p") => ({ VulnerabilityID: id, PkgName: pkg, InstalledVersion: "1", Severity: s })
  const doc = { Results: [{ Vulnerabilities: [v("A", "CRITICAL"), v("A", "CRITICAL"), v("B", "HIGH"), v("C", "weird")] }, { Vulnerabilities: null }] }
  const list = parseTrivy(doc)
  assert.deepEqual(count(list), { critical: 1, high: 1, medium: 0, low: 0 })
  assert.equal(compact(list).length, 3)
  assert.equal(compact(list)[0].severity, "CRITICAL")
  assert.deepEqual(maxOf([{ critical: 1, high: 5, medium: 0, low: 0 }, { critical: 0, high: 7, medium: 2, low: 0 }]), { critical: 1, high: 7, medium: 2, low: 0 })
})

test("bell only when criticals appear", () => {
  assert.equal(newCriticals(null, 2), true)
  assert.equal(newCriticals(0, 2), true)
  assert.equal(newCriticals(3, 5), false)
  assert.equal(newCriticals(null, 0), false)
})

test("source url only http(s)", () => {
  assert.equal(safeUrl("https://github.com/a/b"), "https://github.com/a/b")
  assert.equal(safeUrl("javascript:alert(1)"), null)
  assert.equal(safeUrl(undefined), null)
})
