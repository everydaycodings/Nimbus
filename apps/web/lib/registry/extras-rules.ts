// Pure parts of scanning, artifacts, pull stats and the README source (no database).
// Relative imports only: node --test runs this.

export type Kind = "signature" | "sbom" | "attestation" | "other"

// What a referrer or cosign tag is: a signature, an SBOM, an attestation (provenance, in-toto) or something else.
export function classify(artifactType: string | null | undefined, predicateOrMedia?: string | null): Kind {
  const s = `${artifactType ?? ""} ${predicateOrMedia ?? ""}`.toLowerCase()
  if (/cosign|simplesigning|sigstore|notary|notation|\.sig\b/.test(s) && !/in-toto/.test(s)) return "signature"
  if (/spdx|cyclonedx|sbom/.test(s)) return "sbom"
  if (/in-toto|intoto|attestation|provenance|slsa/.test(s)) return "attestation"
  return "other"
}

// cosign's tag fallback: sha256:<hex> is signed by sha256-<hex>.sig, attested by .att, has an SBOM at .sbom.
export function cosignTags(digest: string) {
  const base = digest.replace(":", "-")
  return { [`${base}.sig`]: "signature", [`${base}.att`]: "attestation", [`${base}.sbom`]: "sbom" } as Record<string, Kind>
}

export const REF_TYPE = "vnd.docker.reference.type"
export const REF_DIGEST = "vnd.docker.reference.digest"
export const PREDICATE = "in-toto.io/predicate-type"

// buildx --provenance/--sbom: attestation manifests listed in an index, each pointing at the image it describes.
export function attestationRefs(index: { manifests?: { digest?: string; annotations?: Record<string, string> }[] }) {
  const out: { digest: string; target: string }[] = []
  for (const d of index.manifests ?? [])
    if (d.digest && d.annotations?.[REF_TYPE] === "attestation-manifest" && d.annotations[REF_DIGEST])
      out.push({ digest: d.digest, target: d.annotations[REF_DIGEST] })
  return out
}

// Fills the days the registry saw no pull: `rows` are {day: "YYYY-MM-DD", count}, the answer is `days` entries ending on `today`.
export function fillDays(rows: { day: string; count: number }[], days: number, today: string) {
  const by = new Map(rows.map((r) => [r.day, r.count]))
  const end = Date.parse(`${today}T00:00:00Z`)
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(end - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10)
    return { day, count: by.get(day) ?? 0 }
  })
}

export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN"
export type Vuln = { id: string; pkg: string; installed: string; fixed: string | null; severity: Severity; title: string | null }
export const SEVERITIES: Severity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"]
export const REPORT_CAP = 2000

// Trivy's JSON (Results[].Vulnerabilities[]) as a flat list.
export function parseTrivy(doc: unknown): Vuln[] {
  const out: Vuln[] = []
  for (const r of ((doc as { Results?: { Vulnerabilities?: Record<string, string>[] | null }[] })?.Results ?? []))
    for (const v of r.Vulnerabilities ?? []) {
      const severity = SEVERITIES.includes(v.Severity as Severity) ? (v.Severity as Severity) : "UNKNOWN"
      out.push({
        id: String(v.VulnerabilityID ?? ""),
        pkg: String(v.PkgName ?? ""),
        installed: String(v.InstalledVersion ?? ""),
        fixed: v.FixedVersion ? String(v.FixedVersion) : null,
        severity,
        title: v.Title ? String(v.Title).slice(0, 200) : null,
      })
    }
  return out
}

// Counts per severity, one entry per (id, package, version).
export function count(vulns: Vuln[]) {
  const seen = new Set<string>()
  const n = { critical: 0, high: 0, medium: 0, low: 0 }
  for (const v of vulns) {
    const k = `${v.id}|${v.pkg}|${v.installed}`
    if (seen.has(k)) continue
    seen.add(k)
    if (v.severity === "CRITICAL") n.critical++
    else if (v.severity === "HIGH") n.high++
    else if (v.severity === "MEDIUM") n.medium++
    else if (v.severity === "LOW") n.low++
  }
  return n
}

// An index's summary: the worst count of each severity across its platforms.
export function maxOf(all: ReturnType<typeof count>[]) {
  return all.reduce(
    (a, c) => ({ critical: Math.max(a.critical, c.critical), high: Math.max(a.high, c.high), medium: Math.max(a.medium, c.medium), low: Math.max(a.low, c.low) }),
    { critical: 0, high: 0, medium: 0, low: 0 }
  )
}

// Deduped, worst first, at most REPORT_CAP.
export function compact(vulns: Vuln[]) {
  const seen = new Set<string>()
  const rank = (v: Vuln) => SEVERITIES.indexOf(v.severity)
  return vulns
    .filter((v) => {
      const k = `${v.id}|${v.pkg}|${v.installed}`
      return !seen.has(k) && seen.add(k)
    })
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, REPORT_CAP)
}

// The bell fires when criticals appear: the first scan with some, or a scan that goes from none to some.
export const newCriticals = (before: number | null, now: number) => now > 0 && (before ?? 0) === 0

export const README_MAX = 64 * 1024

// The one http(s) link worth showing, from the image's source label.
export function safeUrl(u: string | undefined) {
  try {
    const p = new URL(u ?? "")
    return p.protocol === "https:" || p.protocol === "http:" ? p.toString() : null
  } catch {
    return null
  }
}

// ---- R6: packages, SBOMs, diffs, image policy, base-image advice (all pure) ----------------------

export type Counts = ReturnType<typeof count>
export type Pkg = { name: string; version: string; type: string; licenses: string[]; purl?: string; layer?: string | null }
export const PACKAGE_CAP = 20_000

// "os" for apk/deb/rpm, else the package-url type (npm, pypi, golang, maven...), else the fallback.
export function pkgType(purl: string | undefined, fallback = "unknown"): string {
  const t = /^pkg:([a-z0-9.+-]+)\//i.exec(purl ?? "")?.[1]?.toLowerCase()
  if (!t) return fallback
  return t === "apk" || t === "deb" || t === "rpm" ? "os" : t
}

// Trivy's JSON with --list-all-pkgs: vulnerabilities, packages (deduped) and the OS it found.
export function parseTrivyFull(doc: unknown): { vulns: Vuln[]; packages: Pkg[]; truncated: boolean; os: { family: string; name: string } | null } {
  const d = doc as { Metadata?: { OS?: { Family?: string; Name?: string } }; Results?: { Class?: string; Type?: string; Packages?: Record<string, unknown>[] | null }[] }
  const seen = new Set<string>()
  const packages: Pkg[] = []
  let truncated = false
  for (const r of d?.Results ?? [])
    for (const p of r.Packages ?? []) {
      const name = String(p.Name ?? "")
      const version = String(p.Version ?? "")
      const purl = (p.Identifier as { PURL?: string } | undefined)?.PURL
      const type = pkgType(purl, r.Class === "os-pkgs" ? "os" : String(r.Type ?? "unknown"))
      const k = `${type}|${name}|${version}`
      if (!name || seen.has(k)) continue
      seen.add(k)
      if (packages.length >= PACKAGE_CAP) {
        truncated = true
        continue
      }
      const licenses = Array.isArray(p.Licenses) ? (p.Licenses as unknown[]).map(String).filter(Boolean) : []
      packages.push({ name, version, type, licenses, ...(purl && { purl }), layer: (p.Layer as { DiffID?: string } | undefined)?.DiffID ?? null })
    }
  const os = d?.Metadata?.OS?.Family ? { family: d.Metadata.OS.Family, name: String(d.Metadata.OS.Name ?? "") } : null
  return { vulns: parseTrivy(doc), packages, truncated, os }
}

// ---- SBOM parsers ----

type Json = Record<string, unknown>
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : [])

function spdxLicenses(p: Json): string[] {
  const out = new Set<string>()
  for (const l of [p.licenseDeclared, p.licenseConcluded]) if (typeof l === "string" && l && l !== "NOASSERTION" && l !== "NONE") out.add(l)
  return [...out]
}

export function parseSpdx(doc: Json): Pkg[] {
  const out: Pkg[] = []
  for (const p of arr(doc.packages)) {
    const name = String(p.name ?? "")
    if (!name) continue
    const purl = arr(p.externalRefs).find((r) => r.referenceType === "purl")?.referenceLocator as string | undefined
    // The image/root entry (and files) aren't packages: they have no version and no purl.
    if (!p.versionInfo && !purl) continue
    out.push({ name, version: String(p.versionInfo ?? ""), type: pkgType(purl), licenses: spdxLicenses(p), ...(purl && { purl }), layer: null })
  }
  return out
}

export function parseCycloneDx(doc: Json): Pkg[] {
  const out: Pkg[] = []
  for (const c of arr(doc.components)) {
    const name = String(c.name ?? "")
    if (!name || c.type === "file" || c.type === "operating-system") continue
    const purl = typeof c.purl === "string" ? c.purl : undefined
    const licenses = arr(c.licenses)
      .map((l) => String((l.expression as string) ?? (l.license as Json | undefined)?.id ?? (l.license as Json | undefined)?.name ?? ""))
      .filter(Boolean)
    out.push({ name, version: String(c.version ?? ""), type: pkgType(purl), licenses, ...(purl && { purl }), layer: null })
  }
  return out
}

// A bare SPDX/CycloneDX document, or an in-toto statement (BuildKit, cosign attest) whose predicate is one.
export function parseSbom(doc: unknown): { format: "spdx" | "cyclonedx"; packages: Pkg[] } | null {
  let d = doc as Json
  if (!d || typeof d !== "object") return null
  // DSSE envelope: payload is a base64 statement.
  if (typeof d.payload === "string" && d.payloadType) {
    try {
      d = JSON.parse(Buffer.from(d.payload, "base64").toString("utf8"))
    } catch {
      return null
    }
  }
  if (d._type && d.predicate && typeof d.predicate === "object") {
    const p = d.predicate as Json
    // cosign wraps a CycloneDX/SPDX document in {Data: ...} for some predicate types.
    d = p.Data && typeof p.Data === "object" ? (p.Data as Json) : p
  }
  if (d.spdxVersion || Array.isArray(d.packages)) return { format: "spdx", packages: parseSpdx(d) }
  if (d.bomFormat === "CycloneDX" || Array.isArray(d.components)) return { format: "cyclonedx", packages: parseCycloneDx(d) }
  return null
}

// ---- Diffs ----

const key = (p: { name: string; type: string }) => `${p.type}|${p.name}`

// Added, removed, and version changes, matched by name and type. A name that appears twice (two versions)
// is compared as sets of versions: unchanged versions drop out, the rest pair up in order.
export function diffPackages(a: Pkg[], b: Pkg[]) {
  const group = (l: Pkg[]) => {
    const m = new Map<string, Pkg[]>()
    for (const p of l) m.set(key(p), [...(m.get(key(p)) ?? []), p])
    return m
  }
  const ga = group(a)
  const gb = group(b)
  const added: Pkg[] = []
  const removed: Pkg[] = []
  const changed: { name: string; type: string; from: string; to: string }[] = []
  for (const [k, pa] of ga) {
    const pb = gb.get(k) ?? []
    const va = pa.filter((p) => !pb.some((q) => q.version === p.version))
    const vb = pb.filter((q) => !pa.some((p) => p.version === q.version))
    for (let i = 0; i < Math.max(va.length, vb.length); i++) {
      if (va[i] && vb[i]) changed.push({ name: va[i].name, type: va[i].type, from: va[i].version, to: vb[i].version })
      else if (va[i]) removed.push(va[i])
      else added.push(vb[i])
    }
  }
  for (const [k, pb] of gb) if (!ga.has(k)) added.push(...pb)
  const by = (x: { name: string }, y: { name: string }) => x.name.localeCompare(y.name)
  return { added: added.sort(by), removed: removed.sort(by), changed: changed.sort(by) }
}

// Fixed: in a, gone in b. Introduced: new in b. One entry per (id, package) regardless of version, so an
// upgrade that keeps the same CVE under a new version isn't "fixed and introduced".
export function diffVulns(a: Vuln[], b: Vuln[]) {
  const k = (v: Vuln) => `${v.id}|${v.pkg}`
  const ka = new Set(a.map(k))
  const kb = new Set(b.map(k))
  const rank = (v: Vuln) => SEVERITIES.indexOf(v.severity)
  const sort = (l: Vuln[]) => l.sort((x, y) => rank(x) - rank(y))
  return { fixed: sort(a.filter((v) => !kb.has(k(v)))), introduced: sort(b.filter((v) => !ka.has(k(v)))) }
}

export function diffLayers(a: { digest: string; size: number }[], b: { digest: string; size: number }[]) {
  const da = new Set(a.map((l) => l.digest))
  const db = new Set(b.map((l) => l.digest))
  return {
    shared: [...da].filter((d) => db.has(d)).length,
    onlyA: [...da].filter((d) => !db.has(d)).length,
    onlyB: [...db].filter((d) => !da.has(d)).length,
    sizeA: a.reduce((n, l) => n + l.size, 0),
    sizeB: b.reduce((n, l) => n + l.size, 0),
  }
}

export function packagesCsv(pkgs: Pkg[]): string {
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  return ["name,version,type,licenses,purl", ...pkgs.map((p) => [p.name, p.version, p.type, p.licenses.join(" "), p.purl ?? ""].map(q).join(","))].join("\n") + "\n"
}

// A minimal SPDX 2.3 document from a package list.
export function spdxFrom(name: string, pkgs: Pkg[], created = new Date()): Json {
  return {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name,
    documentNamespace: `https://nimbus.invalid/spdx/${encodeURIComponent(name)}-${created.getTime()}`,
    creationInfo: { created: created.toISOString().replace(/\.\d+Z$/, "Z"), creators: ["Tool: Nimbus-Registry"] },
    packages: pkgs.map((p, i) => ({
      SPDXID: `SPDXRef-Package-${i}`,
      name: p.name,
      versionInfo: p.version,
      downloadLocation: "NOASSERTION",
      filesAnalyzed: false,
      licenseConcluded: "NOASSERTION",
      licenseDeclared: p.licenses.length ? p.licenses.join(" AND ") : "NOASSERTION",
      ...(p.purl && { externalRefs: [{ referenceCategory: "PACKAGE-MANAGER", referenceType: "purl", referenceLocator: p.purl }] }),
    })),
  }
}

// Is this manifest an artifact (signature, SBOM, attestation) rather than an image? Policies skip those.
export function isArtifactManifest(doc: { subject?: unknown; artifactType?: string; config?: { mediaType?: string }; layers?: { mediaType?: string }[]; manifests?: unknown[] }, tag?: string): boolean {
  if (tag && /^sha256-[a-f0-9]{64}\.(sig|att|sbom)$/.test(tag)) return true
  if (doc.subject || doc.artifactType) return true
  if (doc.manifests) return false
  if (doc.config?.mediaType && !/image\.config\.v1\+json|container\.image\.v1\+json/.test(doc.config.mediaType)) return true
  return (doc.layers ?? []).some((l) => /in-toto|cosign|spdx|cyclonedx|sigstore/i.test(l.mediaType ?? ""))
}

// ---- Image policy ----

export type ImagePolicy = { maxCritical?: number | null; maxHigh?: number | null; maxAgeDays?: number | null; requireSigned?: boolean; blockedLicenses?: string[]; blockPulls?: boolean; unscannedFails?: boolean }
// unknown: the fact isn't known (not scanned, no package list), which is neither a pass nor a fail.
export type CheckState = "pass" | "fail" | "unknown"
export type Check = { key: string; label: string; state: CheckState; detail: string }
export type Verdict = CheckState
// null means unknown (not scanned, no package list yet, nothing to check).
export type Facts = { critical: number | null; high: number | null; ageDays: number | null; signed: boolean | null; licenses: string[] | null }

const spdxBase = (s: string) => s.toLowerCase().replace(/(-only|-or-later|\+)$/, "")

// Which blocked licenses appear in the (possibly compound) license strings. Matches SPDX ids ignoring case
// and the -only/-or-later/+ suffix, inside expressions like "GPL-2.0-only AND MIT".
export function blockedLicenseHits(blocked: string[], licenses: string[]): string[] {
  const want = new Map(blocked.map((b) => [spdxBase(b.trim()), b.trim()] as const).filter(([k]) => k))
  const hit = new Set<string>()
  for (const l of licenses)
    for (const tok of l.split(/[\s()]+/)) {
      const orig = want.get(spdxBase(tok))
      if (orig && !/^(and|or|with)$/i.test(tok)) hit.add(orig)
    }
  return [...hit]
}

const num = (v: unknown, max: number) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Math.min(max, Math.max(0, Math.floor(Number(v)))) : null)

// Clean what the form sent; an empty policy is no policy.
export function cleanImagePolicy(p: ImagePolicy): ImagePolicy | null {
  const out: ImagePolicy = {}
  const [c, h, a] = [num(p.maxCritical, 100_000), num(p.maxHigh, 100_000), num(p.maxAgeDays, 3650)]
  if (c !== null) out.maxCritical = c
  if (h !== null) out.maxHigh = h
  if (a !== null) out.maxAgeDays = a
  if (p.requireSigned) out.requireSigned = true
  const lic = [...new Set((p.blockedLicenses ?? []).map((l) => String(l).trim()).filter((l) => /^[A-Za-z0-9.+-]{1,64}$/.test(l)))].slice(0, 50)
  if (lic.length) out.blockedLicenses = lic
  // Only the vulnerability limits depend on a scan, so only they can make an unscanned image fail.
  if ((out.maxCritical != null || out.maxHigh != null) && p.unscannedFails) out.unscannedFails = true
  if (Object.keys(out).length && p.blockPulls) out.blockPulls = true
  return Object.keys(out).length ? out : null
}

// verdict: fail if any check fails; else unknown if any check is unknown; else pass (no checks: pass).
export function evaluateImagePolicy(policy: ImagePolicy, f: Facts): { verdict: Verdict; checks: Check[] } {
  const checks: Check[] = []
  const limit = (k: string, label: string, max: number | null | undefined, n: number | null) => {
    if (max == null) return
    if (n === null) checks.push({ key: k, label, state: policy.unscannedFails ? "fail" : "unknown", detail: "Not scanned yet" })
    else checks.push({ key: k, label, state: n <= max ? "pass" : "fail", detail: `${n} found, ${max} allowed` })
  }
  limit("maxCritical", "Critical vulnerabilities", policy.maxCritical, f.critical)
  limit("maxHigh", "High vulnerabilities", policy.maxHigh, f.high)
  if (policy.maxAgeDays != null)
    checks.push(
      f.ageDays === null
        ? { key: "maxAgeDays", label: "Image age", state: "unknown", detail: "Age unknown" }
        : { key: "maxAgeDays", label: "Image age", state: f.ageDays <= policy.maxAgeDays ? "pass" : "fail", detail: `${Math.floor(f.ageDays)} days old, ${policy.maxAgeDays} allowed` }
    )
  if (policy.requireSigned)
    checks.push(
      f.signed === null
        ? { key: "requireSigned", label: "Signed", state: "unknown", detail: "Signature status unknown" }
        : { key: "requireSigned", label: "Signed", state: f.signed ? "pass" : "fail", detail: f.signed ? "Signature found" : "No signature found" }
    )
  if (policy.blockedLicenses?.length)
    if (f.licenses === null) checks.push({ key: "blockedLicenses", label: "Licenses", state: "unknown", detail: "No package list yet" })
    else {
      const hits = blockedLicenseHits(policy.blockedLicenses, f.licenses)
      checks.push({ key: "blockedLicenses", label: "Licenses", state: hits.length ? "fail" : "pass", detail: hits.length ? `Uses ${hits.join(", ")}` : "No blocked licenses" })
    }
  const verdict: Verdict = checks.some((c) => c.state === "fail") ? "fail" : checks.some((c) => c.state === "unknown") ? "unknown" : "pass"
  return { verdict, checks }
}

// ---- Base-image advice ----

// "docker.io/library/alpine:3.10@sha256:..." -> {registry, repo, tag}. Docker Hub names get library/.
export function parseImageRef(ref: string): { registry: string; repo: string; tag: string } | null {
  const noDigest = ref.trim().split("@")[0]
  const m = /^(?:([a-z0-9.-]+(?::\d+)?)\/)?([a-z0-9._\/-]+?)(?::([A-Za-z0-9._-]+))?$/.exec(noDigest)
  if (!m) return null
  let [, registry, repo, tag] = m
  // The first segment is a registry only when it looks like a host.
  if (registry && !/[.:]|^localhost$/.test(registry)) {
    repo = `${registry}/${repo}`
    registry = ""
  }
  registry ||= "docker.io"
  if (/(^|\.)docker\.io$/.test(registry) && !repo.includes("/")) repo = `library/${repo}`
  if (repo === "scratch" || repo.endsWith("/scratch")) return null
  return { registry, repo, tag: tag || "latest" }
}

type Parsed = { nums: number[]; variant: string; vnums: number[] }

// "18-alpine" -> {nums [18], variant "alpine"}; "18.2.0-alpine3.18" -> {[18,2,0], "alpine", [3,18]}; "3.10" -> {[3,10], ""}.
// Anything else (latest, rc, sha tags, dates) is null.
export function parseTagVersion(tag: string): Parsed | null {
  const m = /^v?(\d+(?:\.\d+){0,2})(?:-(.+))?$/.exec(tag)
  if (!m) return null
  const rest = m[2] ?? ""
  // ponytail: variant = the suffix without its trailing version ("alpine3.18" -> "alpine"); a heuristic that
  // treats -slim, -bookworm-slim and -alpine as distinct families. Misses exotic schemes; add per-image rules if needed.
  const vm = /^(.*?)(\d+(?:\.\d+)*)$/.exec(rest)
  const variant = vm ? vm[1] : rest
  if (/(rc|alpha|beta|dev|nightly|snapshot)/i.test(rest)) return null
  return { nums: m[1].split(".").map(Number), variant, vnums: vm ? vm[2].split(".").map(Number) : [] }
}

const cmp = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0)
  return 0
}

// Up to three newer tags of the same shape (same number of version parts) and variant: the newest patch
// (same major.minor, only for a.b.c tags), the newest in the same major, and the newest overall.
export function pickCandidates(current: string, tags: string[]): { tag: string; level: "patch" | "minor" | "major" }[] {
  const cur = parseTagVersion(current)
  if (!cur) return []
  const newer = tags
    .map((t) => ({ t, p: parseTagVersion(t) }))
    .filter((x): x is { t: string; p: Parsed } => !!x.p && x.p.variant === cur.variant && x.p.nums.length === cur.nums.length)
    .filter((x) => cmp(x.p.nums, cur.nums) > 0 || (cmp(x.p.nums, cur.nums) === 0 && cmp(x.p.vnums, cur.vnums) > 0))
    .sort((a, b) => cmp(b.p.nums, a.p.nums) || a.p.vnums.length - b.p.vnums.length || cmp(b.p.vnums, a.p.vnums))
  const out: { tag: string; level: "patch" | "minor" | "major" }[] = []
  const add = (level: "patch" | "minor" | "major", pred: (p: Parsed) => boolean) => {
    const f = newer.find((x) => pred(x.p))
    if (f && !out.some((o) => o.tag === f.t)) out.push({ tag: f.t, level })
  }
  if (cur.nums.length >= 3) add("patch", (p) => p.nums[0] === cur.nums[0] && p.nums[1] === cur.nums[1])
  if (cur.nums.length >= 2) add("minor", (p) => p.nums[0] === cur.nums[0])
  add("major", () => true)
  return out
}

// What the OS in a scanned image says about its base: alpine 3.10.9 -> alpine:3.10, debian 12.5 -> debian:12.
export function baseFromOs(os: { family: string; name: string } | null): { name: string; tag: string } | null {
  if (!os) return null
  const v = os.name.split(".")
  if (os.family === "alpine") return { name: "library/alpine", tag: v.slice(0, 2).join(".") }
  if (os.family === "debian") return { name: "library/debian", tag: v[0] }
  if (os.family === "ubuntu") return { name: "library/ubuntu", tag: v.slice(0, 2).join(".") }
  return null
}
