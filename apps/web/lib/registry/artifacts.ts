// What is attached to an image: signatures (cosign, notation), SBOMs and attestations.
// Found three ways: referrers (a manifest whose subject is the image), cosign's tag fallback
// (sha256-<hex>.sig/.att/.sbom) and buildx's attestation manifests inside an index.
import "server-only"

import { and, eq, inArray, isNull } from "drizzle-orm"

import { db } from "@/lib/db"
import { registryManifests, registryTags } from "@/lib/db/schema"

import { PREDICATE, attestationRefs, classify, cosignTags, type Kind } from "./extras-rules.ts"
import { INDEXES } from "./manifests.ts"

type Item = { digest: string; artifactType: string | null; kind: Kind; createdAt: Date }
type Found = { signatures: number; sboms: number; attestations: number; items: Item[] }

export async function artifactsFor(repoId: string, digests: string[]): Promise<Record<string, Found>> {
  const out: Record<string, Found> = Object.fromEntries(digests.map((d) => [d, { signatures: 0, sboms: 0, attestations: 0, items: [] }]))
  if (!digests.length) return out
  const add = (target: string, i: Item) => {
    const f = out[target]
    if (!f || f.items.some((x) => x.digest === i.digest && x.kind === i.kind)) return
    f.items.push(i)
    if (i.kind === "signature") f.signatures++
    else if (i.kind === "sbom") f.sboms++
    else if (i.kind === "attestation") f.attestations++
  }
  const live = (...c: ReturnType<typeof eq>[]) => and(eq(registryManifests.repoId, repoId), isNull(registryManifests.deletedAt), ...c)

  for (const m of await db.select().from(registryManifests).where(live(inArray(registryManifests.subject, digests))))
    add(m.subject!, { digest: m.digest, artifactType: m.artifactType, kind: classify(m.artifactType, m.mediaType), createdAt: m.createdAt })

  const tags = new Map(digests.flatMap((d) => Object.entries(cosignTags(d)).map(([t, k]) => [t, { d, k }] as const)))
  const tagged = await db
    .select({ name: registryTags.name, digest: registryTags.digest, createdAt: registryTags.pushedAt })
    .from(registryTags)
    .where(and(eq(registryTags.repoId, repoId), isNull(registryTags.deletedAt), inArray(registryTags.name, [...tags.keys()])))
  for (const t of tagged) {
    const { d, k } = tags.get(t.name)!
    add(d, { digest: t.digest, artifactType: null, kind: k, createdAt: t.createdAt })
  }

  // buildx: the attestation manifests are children of the index (and describe each platform image).
  const indexes = await db.select().from(registryManifests).where(live(inArray(registryManifests.digest, digests)))
  const refs = indexes.filter((m) => INDEXES.includes(m.mediaType)).flatMap((m) => attestationRefs(JSON.parse(m.bytes.toString("utf8"))).map((a) => ({ ...a, index: m.digest })))
  if (refs.length) {
    const docs = await db.select().from(registryManifests).where(live(inArray(registryManifests.digest, refs.map((r) => r.digest))))
    for (const a of docs) {
      // One attestation manifest can hold several statements (an SBOM and provenance): one item each.
      const layers = (JSON.parse(a.bytes.toString("utf8")).layers ?? []) as { annotations?: Record<string, string> }[]
      for (const l of layers.length ? layers : [{}]) {
        const predicate = (l as { annotations?: Record<string, string> }).annotations?.[PREDICATE] ?? null
        const kind = classify(null, predicate ?? "attestation")
        for (const r of refs.filter((x) => x.digest === a.digest))
          for (const to of new Set([r.index, r.target])) add(to, { digest: a.digest, artifactType: predicate, kind: kind === "other" ? "attestation" : kind, createdAt: a.createdAt })
      }
    }
  }
  return out
}
