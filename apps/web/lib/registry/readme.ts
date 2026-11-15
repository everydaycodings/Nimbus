// The repository README: the one an owner or writer typed, else the image's own description
// (org.opencontainers.image.description) from the latest tag's manifest annotations or config labels.
import "server-only"

import { and, desc, eq, isNull } from "drizzle-orm"

import { audit } from "@/lib/audit"
import { db } from "@/lib/db"
import { registryBlobs, registryManifests, registryNamespaces, registryRepos, registryTags } from "@/lib/db/schema"
import { getStream } from "@/lib/s3"

import { roleIn } from "./access.ts"
import { README_MAX, safeUrl } from "./extras-rules.ts"
import { INDEXES } from "./manifests.ts"

const DESC = "org.opencontainers.image.description"
const SOURCE = "org.opencontainers.image.source"

type Anns = Record<string, string> | null | undefined

async function labels(repoId: string, digest: string, depth = 0): Promise<Anns> {
  const [m] = await db.select().from(registryManifests).where(and(eq(registryManifests.repoId, repoId), eq(registryManifests.digest, digest), isNull(registryManifests.deletedAt)))
  if (!m) return null
  const doc = JSON.parse(m.bytes.toString("utf8")) as { manifests?: { digest?: string }[]; config?: { digest?: string }; annotations?: Anns }
  if (doc.annotations?.[DESC]) return doc.annotations
  if (INDEXES.includes(m.mediaType)) {
    const first = doc.manifests?.[0]?.digest
    return first && depth < 2 ? labels(repoId, first, depth + 1) : doc.annotations
  }
  if (!doc.config?.digest) return doc.annotations
  const [b] = await db.select({ key: registryBlobs.key, size: registryBlobs.size }).from(registryBlobs).where(eq(registryBlobs.digest, doc.config.digest))
  if (!b || b.size > 1_000_000) return doc.annotations
  try {
    const cfg = JSON.parse(await new Response(await getStream(b.key)).text()) as { config?: { Labels?: Anns } }
    return { ...doc.annotations, ...cfg.config?.Labels }
  } catch {
    return doc.annotations
  }
}

export async function readmeFor(repoId: string): Promise<{ source: "custom" | "annotation" | null; markdown: string | null; sourceUrl: string | null }> {
  const [r] = await db.select({ readme: registryRepos.readme }).from(registryRepos).where(eq(registryRepos.id, repoId))
  const [tag] = await db
    .select({ digest: registryTags.digest })
    .from(registryTags)
    .where(and(eq(registryTags.repoId, repoId), isNull(registryTags.deletedAt)))
    .orderBy(desc(registryTags.pushedAt))
    .limit(1)
  const l = tag ? await labels(repoId, tag.digest) : null
  const sourceUrl = safeUrl(l?.[SOURCE])
  if (r?.readme?.trim()) return { source: "custom", markdown: r.readme, sourceUrl }
  const d = l?.[DESC]?.trim()
  return d ? { source: "annotation", markdown: d.slice(0, README_MAX), sourceUrl } : { source: null, markdown: null, sourceUrl }
}

// Owners and writers of the namespace. null (or blank) goes back to the image's own description.
export async function setReadme(actorUserId: string, repoId: string, markdown: string | null): Promise<{ error?: string }> {
  const [row] = await db
    .select({ repo: registryRepos, ns: registryNamespaces })
    .from(registryRepos)
    .innerJoin(registryNamespaces, eq(registryNamespaces.id, registryRepos.namespaceId))
    .where(and(eq(registryRepos.id, repoId), isNull(registryRepos.deletedAt)))
  const role = row && (await roleIn(actorUserId, row.ns))
  if (!row || (role !== "owner" && role !== "write")) return { error: "You can only read this repository." }
  const text = markdown?.trim() ? markdown : null
  if (text && Buffer.byteLength(text) > README_MAX) return { error: "The README can be 64 KB at most." }
  await db.update(registryRepos).set({ readme: text }).where(eq(registryRepos.id, repoId))
  await audit("registry_readme", { detail: `${row.ns.name}/${row.repo.name}: ${text ? "edited" : "reset to the image description"}` })
  return {}
}
