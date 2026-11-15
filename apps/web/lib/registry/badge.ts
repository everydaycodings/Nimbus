// The build status badge: a small SVG a README can embed. Public repositories are served openly; a private one
// only with its secret badge token, and without it looks exactly like a repository that doesn't exist.
import "server-only"

import { timingSafeEqual } from "node:crypto"

import { and, desc, eq, isNull, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { registryBuilds, registryNamespaces, registryRepos, registryTags } from "@/lib/db/schema"
import { digestBytes } from "./manage.ts"
import { splitName } from "./rules.ts"
import { sizeOf } from "./size.ts"
import type { Badge } from "./badge-svg.ts"

const GREY = "#6b7280"
const none: Badge = { label: "build", value: "none", color: GREY }
const STATE: Record<string, [string, string]> = { success: ["passing", "#2f855a"], failed: ["failing", "#c53030"], stopped: ["stopped", "#b7791f"] }

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

export async function badgeFor(full: string, o: { tag?: string | null; token?: string | null; show?: string | null }): Promise<Badge> {
  const n = splitName(full)
  if (!n) return none
  const [r] = await db
    .select({ id: registryRepos.id, isPublic: registryRepos.isPublic, token: registryRepos.badgeToken })
    .from(registryRepos)
    .innerJoin(registryNamespaces, eq(registryNamespaces.id, registryRepos.namespaceId))
    .where(and(eq(registryNamespaces.name, n.namespace), eq(registryRepos.name, n.repo), isNull(registryRepos.deletedAt)))
  if (!r || (!r.isPublic && !(r.token && o.token && same(r.token, o.token)))) return none
  if (o.show === "size") {
    const [t] = await db
      .select({ digest: registryTags.digest })
      .from(registryTags)
      .where(and(eq(registryTags.repoId, r.id), eq(registryTags.name, o.tag || "latest"), isNull(registryTags.deletedAt)))
    return { label: "image", value: t ? sizeOf((await digestBytes(r.id, [t.digest]))[t.digest]) : "none", color: t ? "#2b6cb0" : GREY }
  }
  const [b] = await db
    .select({ status: registryBuilds.status })
    .from(registryBuilds)
    .where(and(eq(registryBuilds.repoId, r.id), sql`${registryBuilds.status} in ('success','failed','stopped')`, o.tag ? sql`${o.tag} = any(${registryBuilds.tags})` : undefined))
    .orderBy(desc(registryBuilds.createdAt))
    .limit(1)
  const s = b && STATE[b.status]
  return s ? { label: "build", value: s[0], color: s[1] } : none
}
