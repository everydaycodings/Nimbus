// The package list of an image: an attached SBOM when there is one (SPDX or CycloneDX, bare or inside an
// in-toto statement, as buildx and cosign attach them), else the list Trivy gave when it scanned the image.
import "server-only"

import { and, eq, inArray, isNull } from "drizzle-orm"

import { db } from "@/lib/db"
import { registryManifests, registryRepos, registryScans } from "@/lib/db/schema"
import { getStream } from "@/lib/s3"

import { artifactsFor } from "./artifacts.ts"
import { linked } from "./blobs.ts"
import { PACKAGE_CAP, PREDICATE, packagesCsv, parseSbom, spdxFrom, type Pkg } from "./extras-rules.ts"
import { docOf, resolveImage } from "./insights.ts"

export type { Pkg }
type Result = { source: "sbom" | "scan" | null; format?: "spdx" | "cyclonedx" | "trivy"; packages: Pkg[]; truncated: boolean }

const MAX_SBOM_BYTES = 64 * 1024 * 1024
const SBOMISH = /spdx|cyclonedx/i

async function readSbom(repoId: string, digests: string[]): Promise<{ format: "spdx" | "cyclonedx"; packages: Pkg[] } | null> {
  const found = await artifactsFor(repoId, digests)
  const items = digests.flatMap((d) => found[d]?.items ?? []).filter((i) => i.kind === "sbom" || i.kind === "attestation")
  const seen = new Set<string>()
  for (const item of items.sort((a, b) => (a.kind === "sbom" ? -1 : 1) - (b.kind === "sbom" ? -1 : 1))) {
    if (seen.has(`${item.digest}|${item.kind}`)) continue
    seen.add(`${item.digest}|${item.kind}`)
    const [m] = await db.select().from(registryManifests).where(and(eq(registryManifests.repoId, repoId), eq(registryManifests.digest, item.digest), isNull(registryManifests.deletedAt)))
    if (!m) continue
    for (const l of docOf(m).layers ?? []) {
      const ann = (l as { annotations?: Record<string, string> }).annotations
      const hint = `${l.mediaType ?? ""} ${ann?.[PREDICATE] ?? ""} ${ann?.predicateType ?? ""}`
      // An SBOM item's layers are all candidates; for an attestation only those that say SPDX or CycloneDX.
      if (item.kind === "attestation" && !SBOMISH.test(hint)) continue
      if (l.size > MAX_SBOM_BYTES) continue
      const blob = await linked(repoId, l.digest)
      if (!blob) continue
      try {
        const parsed = parseSbom(JSON.parse(await new Response(await getStream(blob.key)).text()))
        if (parsed) return parsed
      } catch {
        // not JSON (gzip, XML...): try the next one
      }
    }
  }
  return null
}

export async function packagesFor(repoId: string, digest: string, o: { platform?: string; prefer?: "sbom" | "scan" } = {}): Promise<Result> {
  const img = await resolveImage(repoId, digest, o.platform)
  if (!img) return { source: null, packages: [], truncated: false }
  const ids = [img.m.id, ...(img.index ? [img.index.id] : [])]
  const fromScan = async (): Promise<Result | null> => {
    const rows = await db.select({ id: registryScans.manifestId, packages: registryScans.packages, truncated: registryScans.packagesTruncated }).from(registryScans).where(inArray(registryScans.manifestId, ids))
    const r = rows.find((x) => x.id === img.m.id && x.packages) ?? rows.find((x) => x.packages)
    return r ? { source: "scan", format: "trivy", packages: r.packages as Pkg[], truncated: r.truncated } : null
  }
  const fromSbom = async (): Promise<Result | null> => {
    const s = await readSbom(repoId, [img.m.digest, ...(img.index ? [img.index.digest] : [])])
    return s ? { source: "sbom", format: s.format, packages: s.packages.slice(0, PACKAGE_CAP), truncated: s.packages.length > PACKAGE_CAP } : null
  }
  const order = o.prefer === "scan" ? [fromScan, fromSbom] : [fromSbom, fromScan]
  for (const f of order) {
    const r = await f()
    if (r) return r
  }
  return { source: null, packages: [], truncated: false }
}

export async function exportSbom(repoId: string, digest: string, format: "csv" | "spdx-json"): Promise<{ filename: string; contentType: string; body: string } | null> {
  const r = await packagesFor(repoId, digest)
  if (!r.source) return null
  const [repo] = await db.select({ name: registryRepos.name }).from(registryRepos).where(eq(registryRepos.id, repoId))
  const base = `${(repo?.name ?? "image").replace(/[^\w.-]+/g, "-")}-${digest.replace(/^sha\d+:/, "").slice(0, 12)}`
  if (format === "csv") return { filename: `${base}-packages.csv`, contentType: "text/csv; charset=utf-8", body: packagesCsv(r.packages) }
  return { filename: `${base}.spdx.json`, contentType: "application/spdx+json", body: JSON.stringify(spdxFrom(base, r.packages), null, 2) }
}
