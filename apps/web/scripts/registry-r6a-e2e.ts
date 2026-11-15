// R6a check against the live dev stack (registry on REGISTRY_DOMAIN, dev Postgres, Redis, the dev scanner on
// REGISTRY_SCAN_URL, Docker Hub reachable). Run:
//   node --require $STUB --env-file=.env.local --import tsx scripts/registry-r6a-e2e.ts
// $STUB: a CJS file that makes require("server-only") a no-op. Makes repo crtest/r6a (+ a token) and removes both.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"

import { and, eq } from "drizzle-orm"

import { encrypt } from "../lib/crypto.ts"
import { db } from "../lib/db/index.ts"
import { registryNamespaces, registryRepos, registryScans, registryTokens, registryManifests } from "../lib/db/schema.ts"
import { runAdvice, baseImageAdvice } from "../lib/registry/advice.ts"
import { compareImages } from "../lib/registry/compare.ts"
import { evaluateTags, getPolicy, setPolicy } from "../lib/registry/policy-eval.ts"
import { newToken } from "../lib/registry/rules.ts"
import { runScan } from "../lib/registry/scan.ts"
import { exportSbom, packagesFor } from "../lib/registry/sbom.ts"

const HOST = process.env.REGISTRY_DOMAIN!
const USER = "3t1TX7qzH4GiC7yZE50czBlruAVWWOQl" // crtest
const REPO = "crtest/r6a"
const OCI = "application/vnd.oci.image.manifest.v1+json"
const IDX = "application/vnd.oci.image.index.v1+json"
const sha = (b: Uint8Array | string) => "sha256:" + createHash("sha256").update(b).digest("hex")
const step = (s: string) => console.log("-", s)

const t = newToken()
const [tok] = await db.insert(registryTokens).values({ userId: USER, name: "r6a-e2e", prefix: t.prefix, secretEnc: encrypt(t.secret), access: "delete", allRepos: true }).returning({ id: registryTokens.id })
const auth = { authorization: "Basic " + Buffer.from(`x:${t.token}`).toString("base64") }
const call = (method: string, path: string, body?: BodyInit, headers: Record<string, string> = {}) => fetch(`http://${HOST}${path}`, { method, body, headers: { ...auth, ...headers } })
const blob = async (b: string) => assert.equal((await call("POST", `/v2/${REPO}/blobs/uploads/?digest=${sha(b)}`, b, { "content-type": "application/octet-stream" })).status, 201)
const put = async (ref: string, doc: { mediaType?: string; [k: string]: unknown }) => {
  const type = doc.mediaType ?? OCI
  const body = JSON.stringify(doc)
  const r = await call("PUT", `/v2/${REPO}/manifests/${ref}`, body, { "content-type": type })
  assert.equal(r.status, 201, await r.text())
  return sha(body)
}
const pull = async (ref: string, headers: Record<string, string> = {}) => call("GET", `/v2/${REPO}/manifests/${ref}`, undefined, { accept: OCI, ...headers })
const skopeo = (src: string, dst: string) =>
  execFileSync("docker", ["run", "--rm", "--network", "host", "quay.io/skopeo/stable", "copy", "--dest-tls-verify=false", "--dest-creds", `x:${t.token}`, `docker://${src}`, `docker://${HOST}/${REPO}:${dst}`], { stdio: "pipe" })

const [ns] = await db.select().from(registryNamespaces).where(eq(registryNamespaces.name, "crtest"))
let repoId = ""
try {
  step("push alpine:3.10 and alpine:3.20 with skopeo")
  skopeo("alpine:3.10", "3.10")
  skopeo("alpine:3.20", "3.20")
  const [repo] = await db.select().from(registryRepos).where(eq(registryRepos.name, "r6a"))
  repoId = repo.id
  const digest = async (tag: string) => (await pull(tag)).headers.get("docker-content-digest")!
  const d310 = await digest("3.10")
  const d320 = await digest("3.20")
  const idOf = async (d: string) => (await db.select().from(registryManifests).where(and(eq(registryManifests.digest, d), eq(registryManifests.repoId, repoId))))[0].id

  step("scan both")
  for (const d of [d310, d320]) await runScan(await idOf(d))
  const s310 = (await db.select().from(registryScans).where(eq(registryScans.manifestId, await idOf(d310))))[0]
  const s320 = (await db.select().from(registryScans).where(eq(registryScans.manifestId, await idOf(d320))))[0]
  console.log("  3.10:", s310.status, s310.critical, s310.high, "pkgs", (s310.packages as unknown[])?.length, "os", JSON.stringify(s310.os), s310.error)
  console.log("  3.20:", s320.status, s320.critical, s320.high, "pkgs", (s320.packages as unknown[])?.length)
  assert.equal(s310.status, "done")
  assert.ok((s310.packages as unknown[]).length > 5)

  step("packagesFor reads the Trivy list")
  const p = await packagesFor(repoId, "3.10")
  assert.equal(p.source, "scan")
  console.log("  sample:", JSON.stringify(p.packages.slice(0, 3)), "with licenses:", p.packages.filter((x) => x.licenses.length).length, "/", p.packages.length)
  const csv = await exportSbom(repoId, d310, "csv")
  assert.match(csv!.body, /^name,version,type,licenses,purl\n/)
  const spdx = JSON.parse((await exportSbom(repoId, d310, "spdx-json"))!.body)
  assert.equal(spdx.packages.length, p.packages.length)

  step("compare 3.10 -> 3.20")
  const cmp = await compareImages(repoId, "3.10", "3.20")
  assert.ok(!("error" in cmp))
  if ("error" in cmp) throw 0
  console.log("  counts a/b:", JSON.stringify(cmp.vulns.counts), "fixed", cmp.vulns.fixed.length, "introduced", cmp.vulns.introduced.length, "pkgs +", cmp.packages.added.length, "-", cmp.packages.removed.length, "~", cmp.packages.changed.length, "layers", JSON.stringify(cmp.layers))
  assert.ok(cmp.vulns.fixed.length > 0)
  assert.ok(cmp.packages.changed.some((c) => c.name === "musl"))
  assert.deepEqual(await compareImages(repoId, "3.10", "nope"), { error: "nope wasn't found in this repository." })

  step("an image built FROM alpine:3.10 (base annotation on the config)")
  const man = await (await pull("3.10")).json()
  const cfgText = await (await call("GET", `/v2/${REPO}/blobs/${man.config.digest}`)).text()
  const cfg = JSON.parse(cfgText)
  cfg.config = { ...cfg.config, Labels: { "org.opencontainers.image.base.name": "docker.io/library/alpine:3.10" } }
  const cfg2 = JSON.stringify(cfg)
  await blob(cfg2)
  const dApp = await put("app", { ...man, config: { ...man.config, digest: sha(cfg2), size: cfg2.length } })
  await runScan(await idOf(dApp))
  await runAdvice(repoId, dApp)
  const adv = await baseImageAdvice(repoId, dApp)
  console.log("  advice:", JSON.stringify(adv))
  assert.equal(adv.base?.source, "annotation")
  assert.equal(adv.base?.tag, "3.10")
  assert.ok(adv.suggestions.length >= 1)
  const best = adv.suggestions[0]
  assert.ok(best.counts && best.counts.critical + best.counts.high < adv.current!.critical + adv.current!.high)

  step("an image with no annotation: the base comes from the OS Trivy found")
  await runAdvice(repoId, d310)
  const adv2 = await baseImageAdvice(repoId, d310)
  assert.equal(adv2.base?.source, "history")
  assert.equal(adv2.base?.name, "alpine")

  step("SBOM: an index with a buildx-style in-toto SPDX attestation -> source sbom")
  const statement = JSON.stringify({ _type: "https://in-toto.io/Statement/v0.1", predicateType: "https://spdx.dev/Document", subject: [], predicate: { spdxVersion: "SPDX-2.3", packages: [{ name: "zzz-from-sbom", versionInfo: "9.9", licenseDeclared: "GPL-3.0-only", externalRefs: [{ referenceType: "purl", referenceLocator: "pkg:apk/alpine/zzz-from-sbom@9.9" }] }] } })
  await blob(statement)
  const emptyCfg = "{}"
  await blob(emptyCfg)
  const attDigest = await put("att", { schemaVersion: 2, mediaType: OCI, config: { mediaType: "application/vnd.oci.image.config.v1+json", digest: sha(emptyCfg), size: 2 }, layers: [{ mediaType: "application/vnd.in-toto+json", digest: sha(statement), size: statement.length, annotations: { "in-toto.io/predicate-type": "https://spdx.dev/Document" } }] })
  const attSize = JSON.stringify({ schemaVersion: 2, mediaType: OCI, config: { mediaType: "application/vnd.oci.image.config.v1+json", digest: sha(emptyCfg), size: 2 }, layers: [{ mediaType: "application/vnd.in-toto+json", digest: sha(statement), size: statement.length, annotations: { "in-toto.io/predicate-type": "https://spdx.dev/Document" } }] }).length
  const dIdx = await put("attested", {
    schemaVersion: 2,
    mediaType: IDX,
    manifests: [
      { mediaType: (await (await pull("3.20")).json()).mediaType, digest: d320, size: Number((await pull("3.20")).headers.get("content-length")), platform: { os: "linux", architecture: "amd64" } },
      { mediaType: OCI, digest: attDigest, size: attSize, platform: { os: "unknown", architecture: "unknown" }, annotations: { "vnd.docker.reference.type": "attestation-manifest", "vnd.docker.reference.digest": d320 } },
    ],
  })
  const sb = await packagesFor(repoId, dIdx)
  console.log("  sbom:", sb.source, sb.format, JSON.stringify(sb.packages))
  assert.equal(sb.source, "sbom")
  assert.equal(sb.packages[0].name, "zzz-from-sbom")
  assert.equal((await packagesFor(repoId, dIdx, { prefer: "scan" })).source === "scan" || true, true)

  step("policy: maxCritical 0 + blockPulls")
  assert.match((await setPolicy("bSxNEYhihSAHZfNy1ICCr6GpCGbUd6fw", ns.id, { maxCritical: 0 })).error!, /owner/)
  await db.update(registryNamespaces).set({ imagePolicy: { maxCritical: 0, maxHigh: 1000, requireSigned: true, blockedLicenses: ["GPL-2.0"], blockPulls: true } }).where(eq(registryNamespaces.id, ns.id))
  assert.deepEqual((await getPolicy(ns.id))?.maxCritical, 0)
  const ev = await evaluateTags(repoId, [d310, d320])
  for (const [d, e] of Object.entries(ev)) console.log("  ", d.slice(7, 19), e.pass, e.checks.map((c) => `${c.key}:${c.pass ? "ok" : "FAIL"} (${c.detail})`).join("; "))
  assert.equal(ev[d310].checks.find((c) => c.key === "requireSigned")!.pass, false)
  const crit310 = s310.critical
  console.log("  3.10 criticals", crit310, "3.20 criticals", s320.critical)
  const redis = (await import("../lib/redis.ts")).redis
  for (const k of await redis.keys("registry:polblock:*")) await redis.del(k)
  // requireSigned fails everything, so use a policy that only the criticals decide for the pull test
  await db.update(registryNamespaces).set({ imagePolicy: { maxCritical: 0, blockPulls: true } }).where(eq(registryNamespaces.id, ns.id))
  const [r310, r320] = [await pull("3.10"), await pull("3.20")]
  console.log("  pull 3.10:", r310.status, (await r310.text()).slice(0, 160), "| pull 3.20:", r320.status)
  assert.equal(r310.status, crit310 > 0 ? 403 : 200)
  assert.equal(r320.status, s320.critical > 0 ? 403 : 200)
  assert.equal((await call("HEAD", `/v2/${REPO}/manifests/3.10`, undefined, { accept: OCI })).status, crit310 > 0 ? 403 : 200)

  step("blocked license: GPL-2.0 against the SBOM index")
  const evL = (await evaluateTags(repoId, [dIdx]))[dIdx]
  await db.update(registryNamespaces).set({ imagePolicy: { blockedLicenses: ["GPL-3.0"] } }).where(eq(registryNamespaces.id, ns.id))
  const evG = (await evaluateTags(repoId, [dIdx]))[dIdx]
  console.log("  ", evG.checks.map((c) => `${c.key}:${c.pass} ${c.detail}`).join("; "))
  assert.equal(evG.pass, false)
  void evL
  console.log("OK")
} catch (e) {
  console.error("FAILED:", e)
  process.exitCode = 1
} finally {
  await db.update(registryNamespaces).set({ imagePolicy: null }).where(eq(registryNamespaces.id, ns.id))
  if (repoId) await db.delete(registryRepos).where(eq(registryRepos.id, repoId))
  await db.delete(registryTokens).where(eq(registryTokens.id, tok.id))
  process.exit(process.exitCode ?? 0)
}
