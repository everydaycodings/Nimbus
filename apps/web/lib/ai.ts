// Which AI features (Phase 20, the optional nimbus-ml service) are on for whom.
// The admin turns each on in Admin → AI features; "Only chosen members" limits them to
// members with user.ai_allowed, plus the owner and admins (who set that list). Faces also
// follow the member's own choice.
import "server-only"

import { eq, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { settings, user } from "@/lib/db/schema"
import { ml, mlBase } from "@/lib/ml"
import type { AiFlags } from "@nimbus/shared/api"

export type AiConfig = typeof settings.$inferSelect

export async function aiConfig() {
  const [s] = await db.select().from(settings)
  return s
}

// Without the pgvector extension the picture and People tables don't exist.
let vector: { at: number; ok: boolean } | undefined
export async function hasVector() {
  if (!vector || Date.now() - vector.at > 60_000) {
    const [r] = await db.execute<{ ok: boolean }>(sql`select exists (select 1 from pg_extension where extname = 'vector') as ok`)
    vector = { at: Date.now(), ok: r.ok }
  }
  return vector.ok
}

// The owner and admins always count as chosen: they can't put themselves on the list.
export const aiAdmin = (role: string | null) => role === "owner" || role === "admin"

export async function aiFlags(userId: string, s?: AiConfig): Promise<AiFlags> {
  s ??= await aiConfig()
  const [u] = await db
    .select({ allowed: user.aiAllowed, role: user.role, faces: user.facesOn })
    .from(user)
    .where(eq(user.id, userId))
  const ok = Boolean(u) && (s.aiAccess === "everyone" || u.allowed || aiAdmin(u.role))
  const vec = ok && (s.mlClip || s.mlFaces) ? await hasVector() : false
  const faces = ok && s.mlFaces && vec
  return {
    speech: ok && s.mlSpeech,
    picture: ok && s.mlClip && vec,
    faces,
    facesOn: faces && (u.faces ?? s.facesDefault),
  }
}

export const mlApi = (s: AiConfig) => ml(mlBase(s.mlUrl))
