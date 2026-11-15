// Shared by the R6 insight pieces (SBOM/packages, compare, advice, policy): find an image by tag or digest,
// pick one platform of an index, and read its config. Kept free of manifests.ts (which enforces policies).
import "server-only"

import { and, eq, inArray, isNull } from "drizzle-orm"

import { db } from "@/lib/db"
import { registryBlobs, registryManifests, registryTags } from "@/lib/db/schema"
import { getStream } from "@/lib/s3"

import { REF_TYPE, attestationRefs } from "./extras-rules.ts"
import { parseDigest } from "./rules.ts"

export type Manifest = typeof registryManifests.$inferSelect
type Doc = { mediaType?: string; manifests?: { digest?: string; platform?: { os?: string; architecture?: string; variant?: string }; annotations?: Record<string, string> }[]; config?: { digest?: string }; layers?: { digest: string; size: number; mediaType?: string }[]; annotations?: Record<string, string> }

const INDEX_TYPES = ["application/vnd.oci.image.index.v1+json", "application/vnd.docker.distribution.manifest.list.v2+json"]
export const docOf = (m: Manifest) => JSON.parse(m.bytes.toString("utf8")) as Doc
export const hostPlatform = () => `linux/${process.arch === "x64" ? "amd64" : process.arch}`

export async function manifestBy(repoId: string, ref: string): Promise<{ m: Manifest; tag: string | null; pushedAt: Date | null } | null> {
  let digest = ref
  let pushedAt: Date | null = null
  let tag: string | null = null
  if (!parseDigest(ref)) {
    const [t] = await db
      .select({ digest: registryTags.digest, pushedAt: registryTags.pushedAt })
      .from(registryTags)
      .where(and(eq(registryTags.repoId, repoId), eq(registryTags.name, ref), isNull(registryTags.deletedAt)))
    if (!t) return null
    ;[digest, pushedAt, tag] = [t.digest, t.pushedAt, ref]
  }
  const [m] = await db.select().from(registryManifests).where(and(eq(registryManifests.repoId, repoId), eq(registryManifests.digest, digest), isNull(registryManifests.deletedAt)))
  return m ? { m, tag, pushedAt: pushedAt ?? m.createdAt } : null
}

// The image to look at: the manifest itself, or for an index the child for `platform` (default: this host's, else
// the first), never buildx's attestation children. `index` is set when a child was chosen.
export async function resolveImage(repoId: string, ref: string, platform?: string) {
  const found = await manifestBy(repoId, ref)
  if (!found) return null
  const { m } = found
  if (!INDEX_TYPES.includes(m.mediaType)) return { ...found, index: null as Manifest | null, platform: null as string | null }
  const doc = docOf(m)
  const skip = new Set(attestationRefs(doc).map((a) => a.digest))
  const kids = (doc.manifests ?? []).filter((d) => d.digest && !skip.has(d.digest) && d.annotations?.[REF_TYPE] !== "attestation-manifest")
  const name = (d: (typeof kids)[number]) => [d.platform?.os, d.platform?.architecture, d.platform?.variant].filter(Boolean).join("/")
  const want = platform ?? hostPlatform()
  const pick = kids.find((d) => name(d) === want) ?? kids.find((d) => name(d).startsWith(want)) ?? (platform ? null : kids[0])
  if (!pick?.digest) return { ...found, index: null, platform: null }
  const [child] = await db.select().from(registryManifests).where(and(eq(registryManifests.repoId, repoId), eq(registryManifests.digest, pick.digest), isNull(registryManifests.deletedAt)))
  return child ? { m: child, tag: found.tag, pushedAt: found.pushedAt, index: m, platform: name(pick) } : { ...found, index: null, platform: null }
}

// The image config JSON (labels, created, history), when the blob is small and stored.
export async function readConfig(m: Manifest): Promise<{ created?: string; config?: { Labels?: Record<string, string> }; history?: { created_by?: string }[] } | null> {
  const digest = docOf(m).config?.digest
  if (!digest) return null
  const [b] = await db.select({ key: registryBlobs.key, size: registryBlobs.size }).from(registryBlobs).where(inArray(registryBlobs.digest, [digest]))
  if (!b || b.size > 1_000_000) return null
  try {
    return JSON.parse(await new Response(await getStream(b.key)).text())
  } catch {
    return null
  }
}
