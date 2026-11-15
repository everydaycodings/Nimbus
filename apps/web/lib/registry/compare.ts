// Compare two images of one repo: packages, vulnerabilities, layers and size. Each side is a tag or a digest;
// an index is compared by one platform (this host's, else the first).
import "server-only"

import { eq } from "drizzle-orm"

import { db } from "@/lib/db"
import { registryScans } from "@/lib/db/schema"

import { diffLayers, diffPackages, diffVulns, type Counts, type Vuln } from "./extras-rules.ts"
import { docOf, resolveImage } from "./insights.ts"
import { packagesFor, type Pkg } from "./sbom.ts"

export type Side = { ref: string; digest: string; size: number; pushedAt: Date | null; platform: string | null }

async function side(repoId: string, ref: string) {
  const img = await resolveImage(repoId, ref)
  if (!img) return null
  const doc = docOf(img.m)
  const layers = (doc.layers ?? []).map((l) => ({ digest: l.digest, size: l.size }))
  const size = layers.reduce((n, l) => n + l.size, 0) + (img.m.size ?? 0)
  const [scan] = await db
    .select({ status: registryScans.status, critical: registryScans.critical, high: registryScans.high, medium: registryScans.medium, low: registryScans.low, report: registryScans.report })
    .from(registryScans)
    .where(eq(registryScans.manifestId, img.m.id))
  const done = scan?.status === "done"
  const counts: Counts = { critical: scan?.critical ?? 0, high: scan?.high ?? 0, medium: scan?.medium ?? 0, low: scan?.low ?? 0 }
  const s: Side = { ref, digest: img.m.digest, size, pushedAt: img.pushedAt, platform: img.platform }
  return { s, layers, done, counts, vulns: done ? ((scan.report as Vuln[] | null) ?? []) : [] }
}

export async function compareImages(repoId: string, a: string, b: string) {
  const [x, y] = await Promise.all([side(repoId, a), side(repoId, b)])
  if (!x || !y) return { error: `${!x ? a : b} wasn't found in this repository.` }
  const [pa, pb] = await Promise.all([packagesFor(repoId, x.s.digest), packagesFor(repoId, y.s.digest)])
  // An SBOM and a Trivy list name packages differently; when the sources differ, compare Trivy's lists.
  let [la, lb]: Pkg[][] = [pa.packages, pb.packages]
  if (pa.source && pb.source && pa.source !== pb.source) [la, lb] = (await Promise.all([packagesFor(repoId, x.s.digest, { prefer: "scan" }), packagesFor(repoId, y.s.digest, { prefer: "scan" })])).map((r) => r.packages)
  const v = diffVulns(x.vulns, y.vulns)
  return {
    a: x.s,
    b: y.s,
    scanned: { a: x.done, b: y.done },
    packages: diffPackages(la, lb),
    vulns: { ...v, counts: { a: x.counts, b: y.counts } },
    layers: diffLayers(x.layers, y.layers),
  }
}
