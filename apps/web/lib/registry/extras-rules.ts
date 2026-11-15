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
